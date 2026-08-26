# HPA-536 Chapter 1 Production Release Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the accepted Chapter 1 build is release-ready using the current Analysis/persistence architecture, add the one missing failed-load session-preservation regression, and record a concrete first-public-release compatibility/evidence baseline.

**Architecture:** This is a verification-first closeout. Reuse existing Rust/component/packaged tests at their current owner boundaries; do not build a new hardening framework or duplicate packaged journeys. Production code is not planned. If a fresh release contract fails, stop at that concrete owner, amend this plan in the same HPA-536 PR, and make only the minimum fix required by the failing player-visible contract.

**Tech Stack:** Rust/Tauri 2, Svelte 5, TypeScript, Vitest/Testing Library, WebdriverIO Tauri E2E, Bun.

**Spec:** `docs/superpowers/specs/2026-08-25-hpa-536-chapter-1-release-hardening-design.md`

## Global Constraints

- One HPA-536 implementation PR; do not split this ticket into multiple PRs.
- Default production-code delta is zero; add production edits only for a freshly reproduced release blocker.
- Keep the post-HPA-521 `ApplicationPersistence` + one `operation_gate` ownership model.
- Keep HPA-549 acquisition semantics: abnormal-crash popup replay is allowed; durable grants remain idempotent.
- Keep HPA-550 dynamic DOM-based save thumbnails and the current capture/sidecar behavior.
- Do not redesign E2E suites/router/chains; HPA-560 owns that simplification.
- Do not add Chapter 2 content, future Analysis board types, save migration infrastructure, controller support, an accessibility framework, or a performance harness.
- Primary supported Chapter 1 desktop acceptance viewport is 1280x720.
- Public pre-release compatibility is strict current-format compatibility; no backward compatibility branch is required before the first public baseline.

---

## File Map

### Planned modifications

- `apps/game/src-tauri/src/game/save/application/tests/commands.rs`
  - add one release characterization proving a failed selected Load does not replace the current live session.

### Planned creation

- `docs/plans/2026-08-25-chapter-1-release-readiness.md`
  - one-time Chapter 1 release evidence/compatibility record.

### Read-only evidence sources

Do not modify these merely to make HPA-536 larger:

- `apps/game/src-tauri/src/game/analysis_integration_tests.rs`
- `apps/game/src-tauri/src/game/save/application/mod.rs`
- `apps/game/src-tauri/src/game/save/application/commands.rs`
- `apps/game/src-tauri/src/game/save/application/tests/*.rs`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.svelte`
- `apps/game/src/lib/components/analysis/AnalysisWorkbench.test.ts`
- `apps/game/src/lib/components/analysis/AnalysisCard.svelte`
- `apps/game/src/lib/components/analysis/AnalysisCard.test.ts`
- `apps/game/src/lib/components/analysis/ClassifyBoard.svelte`
- `apps/game/src/lib/components/analysis/ClassifyBoard.test.ts`
- `apps/game/src/lib/components/analysis/OrderBoard.svelte`
- `apps/game/src/lib/components/analysis/OrderBoard.test.ts`
- `apps/game/src/lib/components/analysis/ThresholdBoard.svelte`
- `apps/game/src/lib/components/analysis/ThresholdBoard.test.ts`
- `apps/game/e2e-tauri/analysis-beat85.e2e.ts`
- `apps/game/scripts/e2e-suite-registry.mjs`
- `apps/game/src-tauri/src/game/content_manifest.rs`

---

### Task 1: Pin failed selected-Load session preservation

**Files:**
- Modify: `apps/game/src-tauri/src/game/save/application/tests/commands.rs`
- Test: `apps/game/src-tauri/src/game/save/application/tests/commands.rs`

**Interfaces:**
- Consumes: `load_save_core(&AppState, SaveSlotRef, String) -> Result<GameplayCommandResultView, GameError>` and `ApplicationPersistence::transition_identity(&AppState) -> Result<SessionTransitionIdentity, GameError>`.
- Produces: one named regression/characterization test; no new runtime API.

This is a characterization of an intended existing invariant, not a pre-authorized production change. The test is expected to pass on a correct current implementation. If it fails, the failure is the concrete HPA-536 release blocker; do not invent another transaction/rollback layer.

- [ ] **Step 1: Add the current command-core import and characterization test**

Extend the existing command import list with `load_save_core`, then add:

```rust
#[tokio::test]
async fn failed_selected_load_keeps_current_session_installed() {
    let fixture = application_fixture_at(7, 12);
    let state = app(&fixture);

    let before = fixture.persistence.transition_identity(&state).unwrap();
    let before_scene = {
        let session = fixture.session.lock().unwrap();
        session
            .engine
            .as_ref()
            .expect("fixture must have a live session")
            .view()
            .unwrap()
            .scene
    };

    let result = load_save_core(
        &state,
        SaveSlotRef::Manual { slot: 1 },
        "missing-selected-save".into(),
    )
    .await;

    assert!(result.is_err());

    let after = fixture.persistence.transition_identity(&state).unwrap();
    assert_eq!(after.generation, before.generation);
    assert_eq!(after.durable_revision, before.durable_revision);

    let after_scene = {
        let session = fixture.session.lock().unwrap();
        session
            .engine
            .as_ref()
            .expect("failed load must keep the live session")
            .view()
            .unwrap()
            .scene
    };
    assert_eq!(after_scene, before_scene);
}
```

If `SceneView` cannot be compared directly on the current baseline, compare the stable scene ID/kind extracted from the two views instead; do not add `PartialEq` solely for this test.

- [ ] **Step 2: Run the focused characterization**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml failed_selected_load_keeps_current_session_installed -- --nocapture
```

Expected: one matching test passes. A failure is not permission for speculative refactoring; inspect whether `load_save_core` replaced/cleared the session before restore-candidate validation and fix only that owner if necessary.

- [ ] **Step 3: Run the surrounding command/application persistence tests**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::save::application::tests::commands -- --nocapture
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::save::application::tests -- --nocapture
```

Expected: both filters complete with zero failed tests.

- [ ] **Step 4: Commit the characterization**

```bash
git add apps/game/src-tauri/src/game/save/application/tests/commands.rs
git commit -m "test(save): pin failed load session preservation"
```

---

### Task 2: Re-verify the existing Chapter 1 deterministic contracts

**Files:**
- Create later in Task 4: `docs/plans/2026-08-25-chapter-1-release-readiness.md`
- No production file changes in this task.

**Interfaces:**
- Consumes: current Analysis integration, Svelte Analysis component, acquisition, save/storage/restore, thumbnail, and exit tests.
- Produces: fresh command evidence to be copied into the release-readiness record; no new framework.

- [ ] **Step 1: Verify Analysis exact-state and result-dialogue persistence**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml game::analysis_integration_tests -- --nocapture
```

The evidence must include the existing contracts for:

- incomplete Order draft detached restore;
- incomplete Threshold draft detached restore;
- full Analysis acceptance round-trip;
- mid-result-dialogue detached restore;
- completed board read-only semantics;
- no duplicated completed-board/scene effects.

Expected: zero failures.

- [ ] **Step 2: Verify Analysis accessibility/semantic fallback ownership**

Run:

```bash
bun run --cwd apps/game test -- \
  src/lib/components/analysis/AnalysisWorkbench.test.ts \
  src/lib/components/analysis/AnalysisCard.test.ts \
  src/lib/components/analysis/ClassifyBoard.test.ts \
  src/lib/components/analysis/OrderBoard.test.ts \
  src/lib/components/analysis/ThresholdBoard.test.ts
```

Expected: zero failures. Use these tests as the primary proof for ARIA state/progress, focus restoration, read-only review, live feedback, native Threshold selection, and non-drag semantic controls. Do not add a second packaged keyboard journey unless these tests reveal a cross-layer behavior they cannot prove.

- [ ] **Step 3: Verify acquisition and persistence semantics at their current owners**

Run the full Rust suite rather than resurrecting removed mechanism-specific filters:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
```

Expected: zero failures, including current acquisition idempotency/replay, storage/restore strictness, atomic write behavior, stale-generation rejection, thumbnail ticket/state, and exit lifecycle contracts.

- [ ] **Step 4: Verify frontend/type/E2E contract compilation**

Run:

```bash
bun run --cwd apps/game check
bun run --cwd apps/game test
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

Expected: all commands exit 0.

- [ ] **Step 5: Do not commit an empty verification task**

There is intentionally no commit for Task 2. Fresh command output is evidence for Task 4's release record. If a deterministic contract fails, keep the failing output, identify the existing owner, amend this plan with the exact minimal production/test change, and keep the fix in the same HPA-536 PR.

---

### Task 3: Run packaged and real-desktop release acceptance

**Files:**
- Update later in Task 4: `docs/plans/2026-08-25-chapter-1-release-readiness.md`
- No E2E registry/router edits.

**Interfaces:**
- Consumes: current `analysis-beat85`, `production-journey`, `capture-proof`, save, management, and exit packaged suites.
- Produces: fresh packaged/manual release evidence; no new suite ID.

- [ ] **Step 1: Run focused packaged Beat 8.5 verification during iteration**

Build the E2E app through the existing script, then run the existing suite:

```bash
bun run --cwd apps/game test:e2e:gameplay
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

Expected: the existing packaged path proves real resources/IPC, Classify+Order Pointer Events listeners, Threshold selection, three partial Save -> Title -> Continue states, board submission, and hearing handoff without adding a second Analysis E2E.

If the local environment cannot launch the packaged binary, do not mark this pass manually. Use the actual CI/manual packaged run as the evidence source in Task 4.

- [ ] **Step 2: Run the existing full release E2E set**

Run:

```bash
bun run --cwd apps/game test:e2e:all
```

Expected: all current suite groups pass. This intentionally reuses the current HPA-516 orchestration; do not simplify it here.

- [ ] **Step 3: Perform the 1280x720 normal-motion desktop check**

On the packaged desktop build, use the existing Chapter 1/Beat 8.5 checkpoint or production path and verify all of the following at 1280x720:

```text
Analysis rail/header/footer all remain visible
long board content scrolls inside the workspace
Classify semantic controls remain reachable
Order semantic controls remain reachable
Threshold selected state is textual + aria-pressed, not color-only
Case File opens/closes without clipping
Save UI opens/closes without clipping
closing the top layer returns focus to a usable game control
Escape closes only the topmost active layer
```

Record the exact build commit and result in Task 4.

- [ ] **Step 4: Perform the reduced-motion check at the same viewport**

Enable the host OS/browser reduced-motion preference, relaunch the packaged build, and repeat one Classify move, one Order edit, one Threshold selection, one rejection, and one completed/read-only board review.

Required result:

```text
No required conclusion depends on animation.
Selected/completed/rejected/read-only state remains available as text/semantics.
All three board types remain operable.
```

Do not add a runtime preference store or animation framework for this check.

- [ ] **Step 5: Perform one keyboard-only Analysis pass**

Without pointer drag:

```text
Classify: select card -> use 放入 action -> remove/reassign at least once
Order: Add/Up/Down/Remove through the authored semantic controls
Threshold: Tab to cards -> Space/Enter selection -> Submit
Completed board: navigate back into read-only review
```

Required result: all Chapter 1 board types can be completed/reviewed and focus never becomes stranded on `<body>` or an unreachable control.

- [ ] **Step 6: Perform a short VoiceOver semantics/focus pass**

At minimum verify:

```text
rail board names expose current/completed/locked/read-only state and progress
Threshold announces selected/unselected state
Classify operation live feedback is announced after an assign/remove/no-op
rejected submit text is announced/focusable
board change announces/focuses the new board heading
```

This is a release observation, not the start of a screen-reader automation framework.

- [ ] **Step 7: Perform one long-session observation**

Run Chapter 1 through the production journey while repeatedly opening Case File, save UI, dialogue history, entering Analysis boards, saving/loading, and returning to title/Continue.

A pass means no reproducible release blocker such as progressive input lag, multi-second board transition degradation, duplicate audio/presentation state, or save/load slowdown severe enough to threaten a normal Chapter 1 playthrough.

Do not create performance benchmarks or telemetry when no blocker is reproduced.

---

### Task 4: Record the first Chapter 1 public release baseline

**Files:**
- Create: `docs/plans/2026-08-25-chapter-1-release-readiness.md`

**Interfaces:**
- Consumes: actual command output from Tasks 1-3, `SAVE_SCHEMA_VERSION`, generated `save_content_manifest.json`, and the tested Git commit.
- Produces: one human-readable release evidence record; this is not a reusable release-management subsystem.

- [ ] **Step 1: Capture the exact tested commit and generated content revision**

Run from repo root after scene compilation/build has generated resources:

```bash
git rev-parse HEAD
bun run scenes:compile
find apps/game/src-tauri -name save_content_manifest.json -print -exec cat {} \;
```

Copy the exact Git SHA and exact `contentRevision` value into the release document. Also read the current `SAVE_SCHEMA_VERSION` from `apps/game/src-tauri/src/game/save/schema.rs`; do not copy a remembered value from an old PR.

- [ ] **Step 2: Create the release-readiness record with actual evidence**

Write `docs/plans/2026-08-25-chapter-1-release-readiness.md` with this structure, replacing every result line with the actual observed command/manual outcome from this PR:

```markdown
# Chapter 1 Release Readiness — HPA-536

## Release baseline
- Verified commit: <paste `git rev-parse HEAD` output>
- Save schema: <paste current `SAVE_SCHEMA_VERSION`>
- Content revision: <paste generated `contentRevision`>
- Supported desktop acceptance viewport: 1280x720
- Supported Analysis input paths: pointer, keyboard, touch semantic controls

## Compatibility contract
- This is the first supported public Chapter 1 save/content baseline.
- Pre-release/development saves are not supported.
- Current-format `contentRevision` compatibility remains strict.
- Dynamic DOM-based thumbnails remain the selected release behavior.
- No save migration framework exists or is required for this baseline.

## Automated evidence
| Contract | Evidence | Result |
| --- | --- | --- |
| Failed selected Load preserves live session | `failed_selected_load_keeps_current_session_installed` | PASS/FAIL from Task 1 |
| Analysis exact drafts + mid-result restore | `game::analysis_integration_tests` | PASS/FAIL from Task 2 |
| Analysis semantics/focus/fallback controls | five Analysis component test files | PASS/FAIL from Task 2 |
| Rust acquisition/persistence/storage/exit | full `cargo test` | PASS/FAIL from Task 2 |
| Frontend/type/E2E contracts | `check`, `test`, `check:e2e`, `test:e2e:ci-contracts` | PASS/FAIL from Task 2 |
| Packaged Chapter 1/persistence/lifecycle | `test:e2e:all` or named CI/manual run | PASS/FAIL from Task 3 |

## Desktop/manual acceptance
| Check | Result | Notes |
| --- | --- | --- |
| 1280x720 normal motion | PASS/FAIL | actual observation |
| 1280x720 reduced motion | PASS/FAIL | actual observation |
| keyboard-only Analysis completion | PASS/FAIL | actual observation |
| VoiceOver semantics/focus | PASS/FAIL | actual observation |
| long Chapter 1 session | PASS/FAIL | actual observation |

## Accepted limitations
- Controller support is not certified for Chapter 1.
- An unacknowledged acquisition popup may replay after an abnormal crash; acknowledgement/grants are idempotent.
- Save thumbnails remain the current DOM-capture/sidecar design.
- Pre-release saves have no compatibility guarantee.
- E2E orchestration remains the current HPA-516 shape until HPA-560.

## Release blockers
State `None observed in the recorded checks.` only if every required row above is backed by a fresh passing result. Otherwise list the concrete failing contract and its owner.
```

Do not literally leave angle-bracket instructions or `PASS/FAIL` alternatives in the committed file; they are execution instructions for this plan. The committed record contains only observed values/results.

- [ ] **Step 3: Cross-check the record against HPA-536 acceptance criteria**

For each HPA-536 acceptance bullet, point to either:

- one deterministic test result;
- one packaged suite result; or
- one named real-desktop observation.

If a bullet has no evidence, do not mark the release ready. Add the smallest missing proof at its existing owner boundary, then update the document.

- [ ] **Step 4: Commit the release evidence**

```bash
git add docs/plans/2026-08-25-chapter-1-release-readiness.md
git commit -m "docs: record Chapter 1 release readiness"
```

---

### Task 5: Final verification and PR closeout

**Files:**
- Modify only if command output requires correcting the release-readiness record.

**Interfaces:**
- Consumes: the complete HPA-536 diff and all current repository validation commands.
- Produces: evidence that the implementation PR itself is reviewable; no new architecture.

- [ ] **Step 1: Format/lint/type-check the final tree**

Run:

```bash
cargo fmt --manifest-path apps/game/src-tauri/Cargo.toml --all --check
cargo clippy --manifest-path apps/game/src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
```

Expected: all commands exit 0.

- [ ] **Step 2: Run final deterministic tests after all edits**

Run:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game test
bun run --cwd apps/game test:e2e:ci-contracts
```

Expected: zero failures.

- [ ] **Step 3: Re-run the release packaged command or cite the exact fresh CI run**

Prefer:

```bash
bun run --cwd apps/game test:e2e:all
```

If the local environment cannot launch packaged Tauri E2E, use the exact fresh workflow run for the current HEAD and add that run reference/result to the release-readiness record before making any release-ready claim.

- [ ] **Step 4: Verify the diff is narrow**

Run:

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected planned implementation shape before any concrete blocker fix:

```text
apps/game/src-tauri/src/game/save/application/tests/commands.rs
docs/plans/2026-08-25-chapter-1-release-readiness.md
```

If production files appear, the PR description must identify the exact failing release contract that justified each one. There must be no E2E router redesign, Chapter 2 content, persistence architecture rewrite, or save migration framework.

- [ ] **Step 5: Commit any evidence-only correction**

Only if the final commands changed facts recorded in the release document:

```bash
git add docs/plans/2026-08-25-chapter-1-release-readiness.md
git commit -m "docs: finalize Chapter 1 release evidence"
```

- [ ] **Step 6: Update HPA-536 / PR status from evidence, not intent**

Keep the PR draft while any release row is failing or unverified. Mark HPA-536 ready for completion only after the release-readiness record contains fresh evidence for every required contract.

---

## Self-review result

### Spec coverage

- Persistence/recovery: covered by Task 1 + existing Rust/storage/restore/acquisition/thumbnail suites in Task 2.
- Analysis exact draft/result restore: explicitly reused in Task 2; no duplicate packaged scenario.
- Accessibility/interaction: component ownership in Task 2; real keyboard/reduced-motion/VoiceOver checks in Task 3.
- Integrated systems: existing packaged suite set in Task 3.
- Packaged/release: full current E2E in Task 3/5, 1280x720 acceptance, long-session observation, and release evidence record.
- First public compatibility baseline: Task 4 records exact schema/content revision without migrations.
- HPA-560 boundary: explicitly protected throughout.

### Placeholder scan

The implementation plan contains no committed-file placeholder requirement. Angle-bracket and `PASS/FAIL` text appears only inside Task 4's execution template and is explicitly forbidden from remaining in the committed release record.

### Type/interface consistency

The only planned code change consumes existing `load_save_core`, `SaveSlotRef`, `ApplicationPersistence::transition_identity`, and fixture helpers already owned by `commands.rs` tests. No new runtime type or cross-task interface is introduced.
