# HPA-536 Chapter 1 Production Release Hardening Design

**Date:** 2026-08-25  
**Status:** Planning baseline for HPA-536, revised after reuse review  
**Linear:** HPA-536 — `[Post-playtest hardening] Prepare Chapter 1 for production release`  
**Target baseline:** current `main` after HPA-549, HPA-550, HPA-521, HPA-621, and the Chapter 1 Beat 8.5 vertical slice

## Decision

Treat HPA-536 as a **release closeout**, not another architecture project.

The implementation PR is verification-first:

1. map each Chapter 1 release promise to the lowest existing test or runtime owner that already proves it;
2. reuse those contracts instead of adding weaker copies;
3. run the existing packaged Chapter 1/persistence/lifecycle suites rather than creating a new E2E framework;
4. perform only the real-desktop checks that Rust/jsdom cannot prove;
5. record the first public Chapter 1 save/content baseline in the existing execution-record area;
6. update the living HPA-540 compatibility policy so later save work cannot accidentally treat that baseline as an internal prototype;
7. change production code only when fresh verification exposes a concrete player-visible blocker.

The expected production-code delta is **zero by default**. This remains one HPA-536 PR.

## Why HPA-536 is the next actionable P2 task

The Chapter 1 vertical slice and its post-acceptance dependencies are settled:

- Beat 8.5 Classify / Order / Threshold and hearing handoff are implemented.
- HPA-549 simplified acquisition acknowledgement to ordinary gameplay/autosave semantics.
- HPA-550 explicitly retained the current dynamic thumbnail behavior.
- HPA-521 collapsed persistence coordination into application-owned `ApplicationPersistence` with one `operation_gate`.
- HPA-621 shipped the redesigned Analysis workbench and its 1280x720 desktop target.

Chapter 2 remains deferred. HPA-536 should close P2 using the product that actually exists, not build future platform machinery.

## Review correction: there is no failed-Load coverage gap

The first draft proposed a new `application/tests/commands.rs` regression for:

> a failed selected Load leaves the current live session unchanged.

That test is unnecessary and weaker than existing coverage.

Current `apps/game/src-tauri/src/lib.rs` already owns the live-session transition contracts:

- `transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged`
  - starts from a live session;
  - writes a real manual save;
  - corrupts its `contentRevision`;
  - calls `load_save_core`;
  - expects `incompatibleContentRevision`;
  - asserts `session_observation` is unchanged.
- the stale-selected-save transition contract also calls `load_save_core` and asserts the same preservation boundary.
- `session_observation` compares the session generation, durable revision, and full serialized public `GameStateView`.
- `game/save/application/tests/commands.rs::build_selected_candidate_rejects_missing_save` already owns the isolated missing-save error path.

Therefore HPA-536 adds **no new Rust test by default**. The existing transition tests are the stronger release proof. If one fails during closeout, fix that concrete existing owner in this same PR.

## Current architecture to preserve

### Analysis runtime and presentation

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

Existing release contracts:

- Rust owns accepted answers, completion, story effects, and result dialogue.
- Classify and Order have direct pointer manipulation plus semantic fallback controls.
- Threshold uses native button selection with `aria-pressed`.
- completed boards remain navigable for read-only review.
- `AnalysisWorkbench` owns focus restoration, status/error surfaces, hint/reset/undo/submit, and board navigation.
- authored Result Dialogue is the success surface; no generated result modal exists.

HPA-536 does not add another state model, focus manager, DnD layer, result overlay, or future board abstraction.

### Save/persistence ownership after HPA-521

```text
ApplicationPersistence
  -> AppSession
  -> one operation_gate
  -> one PersistenceState
  -> SaveFilesystem / root / discovery
  -> autosave / flush / manual save / load / delete / cleanup / exit
  -> thumbnail tickets/activity
```

The deleted writer queue/backend/scheduler/counter machinery is not a release contract and must not be recreated or tested.

### Acquisition after HPA-549

Accepted behavior:

- acquisition atomically commits record, story effects, pending acquisition event, and durable revision;
- ordinary autosave persists that state;
- an unacknowledged popup may replay after an abnormal crash;
- replay/acknowledgement is idempotent and cannot double-grant durable outputs.

HPA-536 does not restore exactly-once acknowledgement persistence.

### Thumbnails after HPA-550

The release-window product decision is explicit:

- retain current dynamic save thumbnails;
- retain the DOM capture/manual-save handshake and current sidecar behavior;
- reuse `capture-proof` and save-management coverage;
- do not add native capture or remove/redesign thumbnail infrastructure here.

### E2E orchestration boundary

Current packaged suite IDs are:

- `smoke`
- `gameplay`
- `production-journey`
- `analysis-beat85`
- `capture-proof`
- `save-core`
- `save-management`
- `exit-lifecycle`

HPA-560 owns simplifying the registry/router/chains. HPA-536 only consumes them.

Important command distinction:

- `bun run --cwd apps/game test:e2e:gameplay` selects only suite ID `gameplay`.
- it is **not** the full gameplay chain and does not include `analysis-beat85`.
- HPA-536 therefore does not use it as a prerequisite to the focused Analysis run.

## Options considered

### Option A — Broad new hardening matrix

Rejected. It duplicates existing Analysis, save, acquisition, thumbnail, and exit proof.

### Option B — One giant release E2E

Rejected. It would be slow, fragile, hard to diagnose, and overlap HPA-560.

### Option C — Release evidence matrix + only real gaps

**Selected.** Reuse existing proof, run it fresh, manually check only real desktop-only behavior, record the release baseline, and fix only failures that actually reproduce.

The reuse review found no pre-existing deterministic behavior gap that deserves a new test before verification runs.

## Release contract ownership matrix

| Release promise | Primary owner | Existing evidence to reuse | HPA-536 delta |
|---|---|---|---|
| Partial Classify draft survives Save -> Title -> Continue | Packaged Analysis journey | `analysis-beat85.e2e.ts` | Fresh run + record |
| Partial Order draft survives Save -> Title -> Continue | Packaged Analysis journey | `analysis-beat85.e2e.ts` | Fresh run + record |
| Partial Threshold draft survives Save -> Title -> Continue | Packaged Analysis journey | `analysis-beat85.e2e.ts` | Fresh run + record |
| Result dialogue restores mid-queue without replaying prior effects | Rust Analysis integration | `analysis_integration_tests.rs` mid-result detached restore | Fresh run + record |
| Completed board is read-only/reviewable | Rust + Svelte | Analysis integration + `AnalysisWorkbench.test.ts` | Fresh run + record |
| Board/result story effects are not duplicated by restore | Rust Analysis integration | full Analysis acceptance round-trip | Fresh run + record |
| Failed selected Load preserves the live session | Tauri command transition contract | `transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged` + stale-selected-save transition contract | **Reuse; no new test** |
| Missing selected save is rejected | application command unit | `build_selected_candidate_rejects_missing_save` | Reuse |
| Committed replacement is atomic/current-format parsing is strict | storage/restore | existing storage/restore/application tests | Fresh full Rust run |
| Acquisition survives restart; popup replay is harmless | acquisition + persistence | HPA-549 unit/integration/packaged coverage | Fresh full Rust/packaged run |
| Dynamic thumbnail succeeds/falls back safely on sidecar failure | thumbnail/storage/packaged | `capture-proof`, `save-management` | Full packaged closeout |
| Persistence has one application owner; stale generations cannot replace newer session | `ApplicationPersistence` | post-HPA-521 application tests | Fresh full Rust run |
| Analysis rail state/progress is textual/semantic | Svelte component | `AnalysisWorkbench.test.ts` | Fresh component run |
| Focus returns to board/card/feedback instead of `<body>` | Svelte component | `AnalysisWorkbench.test.ts` | Fresh component + manual pass |
| Classify screen-reader operation feedback is mounted before mutation | Classify component | mounted polite live region + tests | Fresh component + VoiceOver spot check |
| Classify/Order can complete without pointer drag | board semantic fallback controls | board component tests | Fresh component + keyboard pass |
| Threshold keyboard selection is native | Threshold component | native button + `aria-pressed` tests | Fresh component + keyboard pass |
| Pointer Classify/Order path reaches production Pointer Events listeners | packaged Analysis journey | `analysis-beat85` synthetic PointerEvent path | Focused packaged run |
| 1280x720 fits one Analysis desktop viewport | packaged geometry + desktop | HPA-621 geometry assertions | Focused packaged + manual pass |
| reduced-motion retains understandable state | CSS + textual semantics + desktop | component CSS/semantics | Manual reduced-motion pass |
| Case File/objective/history/acquisition/audio/save/title/continue/exit remain integrated | existing packaged suites | current full suite registry | One full packaged closeout |
| long Chapter 1 session has no release-blocking degradation | real packaged playthrough | production journey + manual observation | Manual release observation |
| first public save/content baseline is visible to future persistence work | living compatibility policy | HPA-540 + HPA-536 execution record | **Update HPA-540 + record actual baseline** |

## Accessibility and interaction closeout

### Supported inputs

Release acceptance covers:

- mouse/pointer;
- keyboard;
- touch through semantic click/tap controls where applicable.

Controller support is not a Chapter 1 release contract.

### Keyboard path

A player must be able to complete all Chapter 1 Analysis boards without drag:

- Classify: select card -> authored `放入...` action -> remove/reassign.
- Order: existing Add/Up/Down/Remove controls.
- Threshold: native button selection -> Submit.

Do not duplicate the packaged Beat 8.5 journey just to automate Tab/Enter. Component semantics plus one manual keyboard release pass are sufficient.

### Screen-reader semantics

Check that state does not depend only on color/position/motion:

- rail board states and progress have accessible descriptions;
- progress elements have labels;
- Threshold selection exposes `aria-pressed`;
- Classify feedback uses the mounted polite live region;
- rejected submit feedback is textual/focusable;
- completed/read-only/locked states have text labels.

One short VoiceOver pass is sufficient. No screen-reader automation framework is added.

### Focus and Escape

Reuse existing ownership:

- Analysis owns board/card/feedback focus restoration.
- GameShell owns Case File, persistence overlays, and topmost Escape ordering.
- Result Dialogue stays dialogue rather than an Analysis modal.

### Reduced motion

The release contract is functional:

- no required conclusion depends on animation;
- selected/completed/rejected/read-only states remain textual/semantic;
- board operations remain usable with reduced motion enabled.

CSS media queries remain the owner; no runtime preference store is added.

## Supported desktop viewport

Primary Chapter 1 acceptance viewport remains **1280x720**.

At that size:

- GameShell owns one fitted viewport;
- Analysis rail/header/footer stay visible;
- long board content scrolls within the workspace;
- primary actions remain reachable;
- Case File/save overlays retain reachable close/confirm controls.

No multi-breakpoint certification matrix is introduced.

## Packaged verification policy

HPA-536 does not create a suite ID or routing policy.

During implementation/iteration, when a focused packaged Analysis proof is useful:

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
```

This avoids the unrelated `gameplay` suite detour.

At release closeout run the current full registry **once**:

```bash
bun run --cwd apps/game test:e2e:all
```

If local packaged execution is unavailable, record the exact CI/manual run that supplies the evidence. Never infer a pass from unit coverage.

HPA-560 may later replace these suite boundaries.

## Long-session/performance closeout

Do not add benchmarks, telemetry, soak harnesses, or performance budgets.

Use one real Chapter 1 run with repeated Analysis/save/load/menu activity. A blocker is a reproducible player-visible problem such as progressive input lag, multi-second transition degradation, severe save/load slowdown, or duplicate audio/presentation state.

If a blocker is reproduced, fix/file that concrete issue. Do not build a performance platform.

## First public save/content baseline

HPA-536 records the first public Chapter 1 persistence baseline as an **audit/reference contract**, not a reason to build migration machinery now.

The execution record must capture:

- exact tested Git commit;
- current `SAVE_SCHEMA_VERSION` read from source;
- exact generated `contentRevision` from the tested packaged content;
- current strict parser/content-revision behavior;
- selected dynamic-thumbnail presentation behavior.

The living HPA-540 policy must point at that record. After the record exists, later persistence work must not call this released tuple an internal prototype or apply the pre-release "delete development saves" rule to it by accident.

This does **not** add golden-save registries, compatibility-window infrastructure, a migration module, or backward-compatibility branches. If future compatibility is needed for a second actually shipped format, make that a separate product decision/ticket.

## Release evidence record location

Use the existing execution-record area:

`docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`

It is a one-time evidence report, not a permanent QA framework. Record:

1. tested commit/branch;
2. `SAVE_SCHEMA_VERSION` and exact `contentRevision`;
3. existing test/suite names and fresh results;
4. packaged suite result or exact CI/manual run source;
5. 1280x720 normal-motion observation;
6. 1280x720 reduced-motion observation;
7. keyboard-only Analysis observation;
8. VoiceOver semantics/focus observation;
9. long-session observation;
10. accepted limitations.

Accepted limitations include:

- controller support is not certified;
- abnormal-crash acquisition popup replay is allowed and idempotent;
- dynamic DOM thumbnail capture remains the selected behavior;
- pre-release development saves are unsupported;
- no migration framework is introduced by this closeout;
- E2E orchestration stays on the HPA-516 shape until HPA-560.

## Implementation scope

Expected HPA-536 implementation delta:

- create/update the release evidence record under `docs/superpowers/plans/`;
- update the HPA-540 living compatibility policy to point future work at the recorded first-public baseline;
- no Rust/TypeScript/Svelte/E2E production or test changes unless a fresh existing contract fails.

Explicitly out of scope:

- duplicate failed-Load regression;
- HPA-560 router/chain cleanup;
- Chapter 2/P3 work;
- migration/golden-save framework;
- controller support;
- accessibility/performance frameworks;
- thumbnail redesign;
- acquisition transaction resurrection.

## Acceptance criteria

- [ ] release matrix references only current architecture and current test owners;
- [ ] existing failed-Load transition contracts are reused rather than duplicated;
- [ ] Classify/Order/Threshold high-risk restore positions are freshly verified;
- [ ] acquisition replay remains idempotent and cannot double-grant;
- [ ] dynamic thumbnail behavior remains consistent with HPA-550;
- [ ] strict current-format parsing, exact `contentRevision`, atomic storage, detached restore, and one-owner persistence are freshly verified;
- [ ] supported pointer/keyboard/touch-semantic Analysis paths remain usable;
- [ ] 1280x720 normal/reduced-motion acceptance has no release blocker;
- [ ] VoiceOver/focus/Escape spot check has no release blocker;
- [ ] Case File, objective, dialogue, audio, popup, save/load/title/continue/exit integrations remain consistent;
- [ ] current packaged registry is run once at closeout or an exact CI/manual run is cited;
- [ ] long-session observation identifies no release blocker;
- [ ] first public baseline is recorded under `docs/superpowers/plans/` and linked from HPA-540;
- [ ] no new migration, E2E, accessibility, or performance framework is introduced;
- [ ] remaining polish is explicitly accepted or moved to focused follow-ups.
