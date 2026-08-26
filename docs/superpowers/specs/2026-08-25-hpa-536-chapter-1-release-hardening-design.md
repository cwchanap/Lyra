# HPA-536 Chapter 1 Production Release Hardening Design

**Date:** 2026-08-25  
**Status:** Planning baseline for HPA-536  
**Linear:** HPA-536 — `[Post-playtest hardening] Prepare Chapter 1 for production release`  
**Target baseline:** current `main` after HPA-549, HPA-550, HPA-521, HPA-621, and the Chapter 1 Beat 8.5 vertical slice

## Decision

Treat HPA-536 as a **release closeout**, not another architecture project.

The implementation PR should be verification-first:

1. map every Chapter 1 release promise to the lowest existing test layer that already proves it;
2. add only the missing deterministic release contract(s);
3. run the existing packaged Chapter 1/persistence/lifecycle suites rather than creating a new E2E framework;
4. perform the small set of real-desktop checks that jsdom/Rust cannot prove;
5. record the first supported public save/content compatibility baseline;
6. change production code only when one of those release contracts exposes a real blocker.

The expected production-code delta is therefore **zero by default**. A real failing contract may justify a minimal fix in the same HPA-536 PR, but HPA-536 does not pre-authorize speculative refactors.

This remains one ticket -> one implementation PR.

## Why HPA-536 is the next actionable P2 task

The Chapter 1 vertical slice and its post-acceptance dependencies are now in place:

- Beat 8.5 Classify / Order / Threshold and hearing handoff are implemented.
- HPA-549 simplified acquisition acknowledgement to ordinary gameplay/autosave semantics.
- HPA-550 explicitly retained the current dynamic thumbnail behavior; no thumbnail architecture change remains pending.
- HPA-521 collapsed persistence coordination into the application-owned `ApplicationPersistence` + one `operation_gate` shape.
- HPA-621 shipped the redesigned Analysis workbench and its 1280x720 desktop target.

The Chapter 2 milestone remains deferred. HPA-536 is therefore the correct place to prove that the accepted Chapter 1 feature set is releasable before expanding the product surface.

## Current architecture to preserve

### Analysis runtime and presentation

The current Analysis ownership model is already the desired long-term shape for Chapter 1:

```text
Rust GameEngine
  -> authored Analysis scene/boards
  -> AnalysisActionToken + whole AnalysisDraft mutation
  -> Rust validation/completion/result dialogue
  -> public GameStateView

Svelte
  -> AnalysisWorkbench
  -> ClassifyBoard / OrderBoard / ThresholdBoard
  -> AnalysisCard
```

Important existing behavior:

- Rust owns accepted answers, completion, story effects, and result dialogue.
- Classify and Order have pointer direct manipulation plus semantic fallback controls.
- Threshold is native button selection with `aria-pressed`.
- completed boards remain navigable in read-only review.
- `AnalysisWorkbench` owns focus restoration, status/error surfaces, hint/reset/undo/submit, and board navigation.
- authored Result Dialogue is the success surface; there is no duplicate generated confirmation modal.

Do not add another frontend state model, result overlay, focus manager, or generalized DnD layer in HPA-536.

### Save/persistence ownership after HPA-521

Persistence is now application-owned:

```text
ApplicationPersistence
  -> AppSession
  -> one operation_gate
  -> one PersistenceState
  -> SaveFilesystem / root / discovery
  -> autosave / flush / manual save / load / delete / cleanup / exit
  -> thumbnail tickets/activity
```

The old queued writer/scheduler architecture is no longer a release contract. HPA-536 tests the current owner and player-visible operations only.

### Acquisition after HPA-549

The accepted player contract is:

- acquisition commits the record, story effects, pending acquisition event, and durable revision together;
- ordinary autosave persists that state;
- an unacknowledged popup may replay after an abnormal crash;
- replay/acknowledgement must be idempotent and must never double-grant durable outputs.

HPA-536 must not restore the deleted exactly-once acknowledgement transaction.

### Thumbnails after HPA-550

The product decision is final for this release window:

- retain current dynamic save thumbnails;
- retain the existing DOM capture/manual-save handshake and current sidecar behavior;
- use the existing `capture-proof` and save-management coverage;
- do not add native capture, remove thumbnails, or redesign the ticket protocol here.

If thumbnail strategy changes again, it needs a separate explicit product decision.

### E2E orchestration boundary

The repository currently owns these packaged suites:

- `smoke`
- `gameplay`
- `production-journey`
- `analysis-beat85`
- `capture-proof`
- `save-core`
- `save-management`
- `exit-lifecycle`

HPA-560 owns simplifying this orchestration after Chapter 1 evidence exists. HPA-536 may **consume** these suites for release proof, but must not refactor their registry/router/chain machinery.

## Options considered

### Option A — Add a broad new hardening test matrix

Add many new unit/integration/E2E cases for every HPA-536 acceptance bullet.

Rejected because it duplicates existing proof and creates permanent maintenance cost for a one-time release closeout. Chapter 1 already has unusually deep coverage in Analysis, persistence, thumbnails, acquisition, and exit lifecycle.

### Option B — Add one giant Chapter 1 release E2E

Build a new packaged scenario that attempts to prove every feature from launch through save corruption, Analysis, accessibility, Case File, acquisition, exit, and restart.

Rejected because it would be slow, fragile, difficult to diagnose, and directly overlap HPA-560's future work on a representative packaged smoke.

### Option C — Release evidence matrix + only real coverage gaps

Map each release guarantee to the lowest existing owner, add only genuinely missing characterization, then run the current packaged suites and a small real-desktop checklist.

**Selected.** It gives the best confidence-to-maintenance ratio and matches the project's current KISS/YAGNI direction.

## Release contract ownership matrix

The implementation should use this ownership model. A higher test layer is not automatically better; packaged coverage is reserved for boundaries that lower layers cannot prove.

| Release promise | Primary owner | Existing evidence to reuse | HPA-536 delta |
|---|---|---|---|
| Partial Classify draft survives Save -> Title -> Continue | Packaged Analysis journey | `analysis-beat85.e2e.ts` | Record as existing proof; no duplicate |
| Partial Order draft survives Save -> Title -> Continue | Packaged Analysis journey | `analysis-beat85.e2e.ts` | Record as existing proof; no duplicate |
| Partial Threshold draft survives Save -> Title -> Continue | Packaged Analysis journey | `analysis-beat85.e2e.ts` | Record as existing proof; no duplicate |
| Result dialogue can restore mid-queue without replaying prior board effects | Rust Analysis integration | `analysis_integration_tests.rs` detached mid-result restore | Record as existing proof; no packaged duplicate |
| Completed board is read-only and reviewable | Rust + Svelte | Analysis integration + `AnalysisWorkbench.test.ts` | Record as existing proof |
| Board/result story effects are not duplicated by restore | Rust Analysis integration | full Analysis acceptance round-trip | Record as existing proof |
| Failed selected Load leaves the current live session installed | Application persistence command boundary | command structure prepares candidate before install, but no dedicated release assertion is required by existing HPA work | **Add one regression test** |
| Committed slot replacement is atomic/current-format parse is strict | Storage/restore | existing storage/restore test suites and HPA-540 contracts | Record as existing proof |
| Acquisition survives restart; abnormal-crash popup replay is harmless | Acquisition + persistence | HPA-549 unit/integration/packaged coverage | Record as existing proof |
| Dynamic thumbnail remains available when capture succeeds and degrades safely when sidecar is missing/corrupt | Thumbnail + storage + packaged | `capture-proof`, `save-management` | Record as existing proof |
| Persistence has one application owner and stale generations cannot replace a newer session | `ApplicationPersistence` | post-HPA-521 application tests | Record current owner, not deleted writer mechanisms |
| Analysis rail state/progress has text/ARIA semantics | Svelte component | `AnalysisWorkbench.test.ts` | Record as existing proof |
| Focus returns to board/card/feedback instead of `<body>` | Svelte component | `AnalysisWorkbench.test.ts` | Record as existing proof |
| Classify screen reader action announcements exist before first mutation | Classify component | permanently mounted polite live region + component tests | Record as existing proof |
| Classify/Order can be completed without pointer drag | semantic fallback controls | board component tests | Record as existing proof |
| Threshold works with native button keyboard semantics | Threshold component | native button + `aria-pressed` tests | Record as existing proof |
| Pointer Classify/Order path works through production Pointer Events listeners | packaged Analysis journey | `analysis-beat85` synthetic PointerEvent decision path | Record the intentionally narrow transport claim |
| 1280x720 Analysis shell fits one desktop viewport | real packaged layout | HPA-621 target + packaged geometry assertions | Re-run and record release acceptance |
| reduced-motion preference does not require motion to understand state | CSS + real desktop preference | current reduced-motion CSS / textual state surfaces | Re-run real-desktop acceptance; do not add animation framework |
| Case File/objective/history/acquisition/audio/save/title/continue/exit remain usable around Analysis | existing cross-layer suites | gameplay, production-journey, analysis-beat85, save/exit suites | Run current release suite set; no new monolith |
| long Chapter 1 usage does not show release-blocking slowdown/leak symptoms | real packaged playthrough | existing production journey + full Chapter 1 run | Manual release observation only; no benchmark framework |
| first public save compatibility contract is explicit | release documentation | HPA-540 strict current-format behavior | Record baseline at release verification |

## The one new deterministic persistence regression

Add one application-layer test around `load_save_core` (or the smallest current command-core seam) that starts with a real live session, attempts to load a missing/invalid selected save candidate, observes an error, and proves the live session identity/state did not change.

The important assertion is not a particular filesystem error string. The invariant is:

```text
before failed load
  session generation = G
  durable revision = R
  current scene/mode = S

after failed load
  returns Err(...)
  session generation = G
  durable revision = R
  current scene/mode = S
```

This is the release guarantee that matters to the player: selecting a bad save must not destroy the session they were already playing.

Do not introduce a second transaction or rollback mechanism. The current command already builds the restore candidate before `install_session_if_current`; the regression test pins that ownership boundary.

## Accessibility and interaction closeout

### Supported inputs for Chapter 1

Release acceptance covers:

- mouse/pointer;
- keyboard;
- touch through semantic click/tap controls where applicable.

Controller support is not an accepted Chapter 1 contract and remains outside HPA-536.

### Keyboard path

A player must be able to complete every Chapter 1 Analysis board without custom drag:

- Classify: select a card, use the authored group `放入...` action, remove/reassign when needed.
- Order: use the existing Add/Up/Down/Remove semantic controls.
- Threshold: native pressed-button selection + Submit.

The packaged pointer proof remains useful for the direct-manipulation path, but keyboard completion belongs primarily to component semantics and one manual release pass. Do not duplicate the entire packaged Beat 8.5 journey just to replace pointer events with Tab/Enter.

### Screen reader semantics

Release acceptance checks that state is available as text/semantics, not only color or position:

- board state and progress have accessible descriptions;
- native progress elements have labels;
- selected Threshold cards expose `aria-pressed`;
- Classify operation feedback uses a mounted polite live region;
- submit rejection/status is textual and focusable;
- completed/read-only/locked states have text labels;
- no required conclusion depends only on drag animation or drop-zone color.

A short VoiceOver pass on the supported desktop build is sufficient. Do not add an accessibility abstraction or screen-reader test framework.

### Focus and Escape

Reuse the existing ownership:

- Analysis owns board/card/feedback focus restoration.
- GameShell owns Case File, persistence overlays, and Escape-layer ordering.
- authored Result Dialogue remains dialogue, not a new Analysis modal.

The release checklist should verify that opening/closing Case File and save UI from Analysis returns to a usable control and that Escape closes only the topmost active layer.

### Reduced motion

The release contract is functional, not visual perfection:

- state remains understandable with OS/browser reduced-motion enabled;
- no required interaction depends on animated movement;
- direct-manipulation feedback may become static;
- textual/semantic selected, completed, rejected, and drop-state feedback remains sufficient.

Do not add a global animation preference store. CSS media queries are enough for the current product.

## Supported desktop viewport

Keep the HPA-621 baseline:

> **1280x720 is the primary supported Chapter 1 desktop acceptance viewport.**

At that size:

- GameShell owns one fitted viewport;
- Analysis rail/header/footer remain visible;
- long board content scrolls inside the workspace rather than stacking the page;
- primary actions remain reachable;
- Case File/save overlays fit without clipping their close/confirm controls.

A 1280x800 run may remain useful as a secondary regression already present in E2E, but HPA-536 does not create a multi-breakpoint responsive certification matrix.

## Packaged release verification policy

HPA-536 does **not** create a new suite ID or routing policy.

For implementation iteration:

```bash
bun run --cwd apps/game test
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game check
bun run --cwd apps/game check:e2e
bun run --cwd apps/game test:e2e:ci-contracts
```

For focused packaged Analysis verification after the E2E binary is built:

```bash
node apps/game/scripts/run-save-e2e.mjs --suite analysis-beat85
```

For release/full verification:

```bash
bun run --cwd apps/game test:e2e:all
```

If the local environment cannot build/run the packaged Tauri binary, the release-readiness document must say so and point to the CI/manual run that supplies that evidence. Do not claim a packaged check passed without a real run.

HPA-560 may later replace these commands and suite boundaries; HPA-536 should not pre-implement that simplification.

## Long-session and performance closeout

Do not add benchmarks, telemetry, soak harnesses, or performance budgets for this hobby release.

Use one real Chapter 1 production journey plus repeated Analysis/save/load entry as the release observation. A blocker means a visible or reproducible problem such as:

- progressive input lag;
- repeated multi-second board transition delays;
- save/load becoming materially slower over the same session;
- memory growth severe enough to threaten a normal Chapter 1 playthrough;
- audio/presentation state accumulating duplicates.

If none is observed, record the manual pass. If one is observed, file/fix that concrete bug; do not build a general performance platform.

## First public save/content compatibility baseline

The release-readiness record must freeze the first supported public contract without adding migration machinery.

Baseline rules:

- current `SAVE_SCHEMA_VERSION` is the supported public schema version for the Chapter 1 release build;
- `contentRevision` compatibility remains the strict current-format behavior chosen by HPA-540;
- pre-release/development saves are unsupported and may be rejected;
- current dynamic thumbnail sidecar behavior is part of this release's save presentation, not a compatibility promise that requires future migration;
- no backward-compatibility branch or migration framework is introduced until there is a second real public format to migrate from.

At release verification time, record the exact packaged build commit and the exact observed `contentRevision` from a save produced by that build. This is an execution result, not a new schema field.

## Release readiness record

The implementation PR should create:

`docs/plans/2026-08-25-chapter-1-release-readiness.md`

It is a small evidence report, not a permanent QA system. It should contain:

1. release commit/branch under test;
2. compatibility baseline (`SAVE_SCHEMA_VERSION`, exact observed `contentRevision`);
3. automated contract matrix with command/test evidence;
4. packaged suite results or the exact CI/manual source that ran them;
5. 1280x720 normal-motion and reduced-motion desktop observations;
6. keyboard-only Analysis pass;
7. short VoiceOver semantics/focus pass;
8. long-session observation;
9. explicit remaining accepted limitations.

Accepted limitations should include at least:

- controller support is not certified;
- abnormal-crash acquisition popup replay is allowed and idempotent;
- thumbnail capture remains the current DOM-based design;
- pre-release save compatibility is not promised;
- E2E orchestration remains the current HPA-516 shape until HPA-560.

Do not turn this document into an ongoing release-management framework.

## Implementation scope

The expected implementation touches are intentionally small:

### Required source/test delta

- `apps/game/src-tauri/src/game/save/application/tests/commands.rs`
  - add the failed-selected-load/live-session-preservation regression.

### Required release record

- `docs/plans/2026-08-25-chapter-1-release-readiness.md`
  - record the actual evidence and public compatibility baseline.

### Production files

None are planned.

If the new regression, current unit suites, packaged suites, or manual release checks expose an actual blocker, fix only that blocker's existing owner in the same PR and amend the release record with the failing/passing evidence. Do not opportunistically refactor neighboring systems.

## Explicit non-goals

- No Chapter 2 content or future board types.
- No accepted Chapter 1 story/board redesign.
- No new persistence coordinator, queue, scheduler, lock hierarchy, or transaction framework.
- No restoration of the deleted acquisition acknowledgement transaction.
- No thumbnail architecture decision or native capture spike.
- No save migration/backward-compatibility framework.
- No E2E router/chain/suite redesign; HPA-560 owns that.
- No screenshot framework.
- No accessibility framework or controller layer.
- No performance benchmark/telemetry platform.
- No multi-instance/cloud/cross-device persistence.

## Acceptance criteria

HPA-536 is ready to close only when all of the following are backed by fresh evidence:

- [ ] Chapter 1 Analysis partial Classify/Order/Threshold drafts restore exactly through the existing packaged journey.
- [ ] Analysis result-dialogue restore and read-only completed-board semantics remain covered by deterministic Rust tests.
- [ ] A failed selected Load has a dedicated regression proving the live session is unchanged.
- [ ] Current storage/restore tests prove atomic replacement and strict current-format parsing.
- [ ] HPA-549 acquisition replay/idempotency contracts remain green.
- [ ] Current dynamic thumbnail capture/degradation contracts remain green; no removed/native protocol is introduced.
- [ ] Analysis board state/progress, feedback, selection, and focus are not color/motion/spatial-only.
- [ ] Mouse/pointer and keyboard completion paths remain usable; touch retains semantic tap controls.
- [ ] Case File, objective/history, acquisition, audio, save/load, title/continue, and exit remain integrated around Analysis.
- [ ] 1280x720 packaged desktop acceptance is recorded for normal motion and reduced motion.
- [ ] A short screen-reader/focus pass is recorded.
- [ ] A Chapter 1 long-session observation finds no release-blocking regression, or any blocker found is fixed in the same PR.
- [ ] The release-readiness document records the first public save schema/content-revision baseline and accepted limitations.
- [ ] No HPA-560 orchestration simplification, Chapter 2 expansion, or speculative architecture work is pulled into the PR.

## Review heuristic

A review suggestion should be rejected as scope creep when it creates infrastructure whose only purpose is to make HPA-536 feel more comprehensive.

The release question is simple:

> Can the accepted Chapter 1 build survive its real player interactions, save/recovery boundaries, and supported desktop accessibility path with evidence we can point to?

If an existing test already answers that question, reuse it. If it does not, add the smallest proof at the owner boundary. Only change production behavior when that proof exposes a real bug.
