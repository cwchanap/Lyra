# HPA-536 Chapter 1 Production Release Hardening Design

**Date:** 2026-08-25  
**Status:** Planning baseline for HPA-536, revised after reuse/evidence review  
**Linear:** HPA-536 — `[Post-playtest hardening] Prepare Chapter 1 for production release`  
**Target baseline:** current `main` after HPA-549, HPA-550, HPA-521, HPA-621, and the Chapter 1 Beat 8.5 vertical slice

## Decision

Treat HPA-536 as a **release closeout**, not another architecture project.

The implementation is verification-first:

1. reuse the lowest existing owner for each release contract;
2. persist evidence as each verification phase finishes instead of reconstructing it later from executor memory;
3. run the existing packaged suites rather than adding a release-specific E2E framework;
4. keep manual checks only for behavior that automated layers cannot prove reliably;
5. fix production/test code only after a current contract reproduces a concrete release blocker;
6. record the first public save/content baseline through the living HPA-540 policy.

Expected production/test-code delta is **zero by default**. This remains one HPA-536 PR.

## Current architecture to preserve

### Analysis

```text
Rust GameEngine
  -> authored Analysis boards
  -> AnalysisActionToken + AnalysisDraft mutation
  -> Rust validation/completion/result dialogue
  -> GameStateView

Svelte
  -> AnalysisWorkbench
  -> ClassifyBoard / OrderBoard / ThresholdBoard
  -> AnalysisCard
```

Rust owns accepted answers, completion, story effects, durable drafts, and Result Dialogue. Svelte owns presentation, focus restoration, semantic fallback controls, and board navigation. HPA-536 does not add another state model, focus manager, DnD layer, or result overlay.

### Persistence after HPA-521

```text
ApplicationPersistence
  -> AppSession
  -> one operation_gate
  -> one PersistenceState
  -> SaveFilesystem / root / discovery
  -> autosave / flush / manual save / load / delete / cleanup / exit
  -> thumbnail tickets/activity
```

Deleted writer/backend/scheduler mechanisms are not release contracts and are not resurrected for testing.

### Acquisition and thumbnails

HPA-549 remains the acquisition contract: durable outputs are idempotent, while an unacknowledged popup may replay after abnormal crash.

HPA-550 remains the thumbnail decision: dynamic DOM-based capture and current sidecar behavior stay in place. HPA-536 consumes existing capture/save-management evidence and does not redesign thumbnails.

### E2E orchestration

HPA-536 consumes the current suite registry. HPA-560 owns future orchestration simplification.

`test:e2e:gameplay` selects only suite ID `gameplay`; it is not the gameplay chain and does not include `analysis-beat85`. Focused Analysis verification therefore builds once and invokes `analysis-beat85` directly.

## Review correction: no new failed-Load test

The first draft proposed a `commands.rs` regression for failed selected Load preserving the live session. Existing `apps/game/src-tauri/src/lib.rs` transition contracts are stronger:

- `transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged` uses a real manual save, invalidates its `contentRevision`, calls `load_save_core`, and expects `incompatibleContentRevision`;
- `session_observation` compares generation, durable revision, and the complete serialized public view;
- the stale-selected-save transition contract protects the same live-session boundary;
- `build_selected_candidate_rejects_missing_save` already owns the isolated missing-ID path.

HPA-536 re-runs those owners. It adds no duplicate regression unless fresh verification finds a genuinely uncovered failure mode.

## Evidence lifecycle

Release verification is long enough that evidence must not exist only in one task/subagent context.

Create the readiness record before the first verification command:

`docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md`

Append and commit observed evidence after each phase:

1. deterministic Rust/frontend contracts;
2. focused `analysis-beat85` packaged run;
3. bounded real-desktop observations;
4. final full packaged closeout and baseline identity.

Do not paste large terminal transcripts into the record. Reference durable evidence where it already exists:

- `apps/game/e2e-artifacts/save-e2e/runs/<run-id>/run-result.json`;
- runner phase output directories under that run;
- 1280x720 PNG/JSON captures emitted by `captureMockupViewport`.

`run-save-e2e.mjs` already gives every phase an attempt-specific `LYRA_E2E_OUTPUT_DIR`; HPA-536 does not add another artifact/output mechanism or require a caller-managed output-directory override.

## Release contract ownership matrix

| Release promise | Primary owner | Existing evidence | HPA-536 action |
|---|---|---|---|
| Partial Classify/Order/Threshold drafts survive Save -> Title -> Continue | packaged Analysis | `analysis-beat85.e2e.ts` | fresh run + record run artifact |
| Mid-result restore does not replay prior board effects | Rust Analysis integration | `analysis_integration_tests.rs` | fresh run |
| Completed board is read-only/reviewable | Rust + Svelte | Analysis integration + `AnalysisWorkbench.test.ts` | fresh run |
| Failed selected Load preserves live session | Tauri transition contract | `transition_contract_load_build_failure_keeps_public_view_and_generation_unchanged` + stale-selection contract | fresh run; no new test |
| Atomic replacement/current-format strictness | storage/restore | current Rust suites | plain + `--all-features` Rust runs |
| Acquisition replay is harmless/idempotent | acquisition + persistence | HPA-549 coverage | full Rust/packaged closeout |
| Dynamic thumbnails succeed/fallback safely | thumbnail/storage/packaged | `capture-proof`, `save-management` | full packaged closeout |
| One persistence owner / stale session replacement rejected | `ApplicationPersistence` | post-HPA-521 tests | full Rust run |
| Analysis rail/progress/fallback semantics | Analysis components | Analysis component tests | focused frontend run |
| Escape closes only topmost claimed layer | escape coordinator | `escape-coordinator.test.ts` | focused frontend run; not manual |
| GameShell overlay Escape/focus integration | GameShell | `GameShell.test.ts` | focused frontend run; manual only for native focus observations not represented in jsdom |
| Pointer Classify/Order reaches production Pointer Events listeners | packaged Analysis | `analysis-beat85` | focused packaged run |
| 1280x720 Analysis geometry/captures | packaged Analysis | `MOCKUP_VIEWPORT`, geometry assertions, `captureMockupViewport` | fresh run + retain artifact paths; physical-window spot check only |
| reduced-motion keeps state understandable | CSS + semantic state + host preference | existing media rules/component semantics | real-host reduced-motion spot check |
| VoiceOver exposes key state/focus | macOS screen reader | no deterministic screen-reader owner | short real-host spot check |
| Chapter 1 integrations remain intact | current packaged registry | gameplay/production/persistence/exit suites | one full packaged closeout |
| no release-blocking progressive degradation | real packaged session | bounded manual observation | record exact route/cycles/result |
| first public save/content baseline is discoverable | HPA-540 + readiness record | current strict parser/content manifest | record merge-stable identity |

## Why both Rust feature surfaces remain

Run both:

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
cargo test --manifest-path apps/game/src-tauri/Cargo.toml --all-features
```

They are intentionally not collapsed. Real persistence/E2E-adjacent tests are gated behind the `e2e` feature, so plain `cargo test` and all-features exercise different surfaces.

## Accessibility and interaction closeout

Supported Chapter 1 input paths are pointer/mouse, keyboard, and touch through semantic controls. Controller support is not certified.

Keyboard completion remains:

- Classify: select -> `放入...` -> remove/reassign;
- Order: Add/Up/Down/Remove;
- Threshold: native pressed-button selection -> Submit.

Deterministic Escape ordering belongs to `escape-coordinator.test.ts` and `GameShell.test.ts`, not a human checklist. The real-host pass checks only what those tests cannot prove, such as actual OS focus behavior after native-window interaction.

VoiceOver remains a small release observation, not a new automation framework.

## 1280x720 ownership

1280x720 is the primary Chapter 1 desktop acceptance viewport.

`analysis-beat85.e2e.ts` already requests `MOCKUP_VIEWPORT = { width: 1280, height: 720 }`, captures screenshots/metadata, and performs Analysis geometry assertions. HPA-536 must reuse that evidence rather than treating viewport fit as purely manual.

The manual pass is narrowed to physical-window/native-host behavior: visible clipping that differs from the packaged capture, reachable overlay controls, and usable focus after closing overlays.

## Packaged verification policy

Focused iteration:

```bash
cd apps/game
node scripts/build-e2e.mjs
node scripts/run-save-e2e.mjs --suite analysis-beat85
cd ../..
```

The runner already writes `run-result.json` and attempt output/captures below `apps/game/e2e-artifacts/save-e2e/runs/<run-id>/`.

Final closeout runs the full registry **once**:

```bash
bun run --cwd apps/game test:e2e:all
```

If local packaged execution is unavailable, cite the exact CI/manual run that supplied equivalent evidence. Do not infer a pass from lower-level tests.

## Conditional blocker path

If any deterministic, packaged, or manual release check fails:

1. reproduce the failure at the smallest existing owner named in the matrix;
2. add or strengthen a failing regression at that owner only when existing coverage does not already fail;
3. make the smallest production fix;
4. re-run the owner that caught the bug plus the higher-level suite/check that exposed it;
5. append the blocker, fix, and fresh results to the readiness record.

Hard stop: if the required fix is framework-scale, requires HPA-560-style E2E restructuring, broad persistence architecture work, or another out-of-scope subsystem, do not widen HPA-536. Record the limitation/blocker and create a focused follow-up instead.

## Bounded long-session observation

Keep this qualitative; do not add telemetry or benchmarks.

Use the packaged production-journey route as the anchor, then perform **five repeated integration cycles** during the same session. Each cycle includes:

```text
open/close Case File
open/close dialogue history
enter/revisit Analysis
manual Save or Load
Return to Title
Continue
confirm audio/presentation state remains singular
```

Record the elapsed observation window approximately and the five-cycle result verbatim, for example `no progressive degradation noticed during ~N minutes / five cycles`. A failure must identify a reproducible player-visible symptom; do not invent a numeric performance budget.

## First public baseline identity

The canonical persistence identity must survive squash/rebase landing. Therefore the release baseline is:

```text
SAVE_SCHEMA_VERSION + exact contentRevision loaded by the tested packaged binary
```

The readiness record also names PR #74 and the tested branch/head as provenance, but the branch SHA is not the compatibility key.

Do not run `scenes:compile` again after packaged verification just to obtain the baseline. `build-e2e.mjs` already runs the Tauri `beforeBuildCommand`, then copies emitted resources into the tested binary layout.

Read the pinned paths:

```text
apps/game/src-tauri/resources/scenes/save_content_manifest.json
apps/game/src-tauri/target-e2e/debug/resources/scenes/save_content_manifest.json
```

The two manifests must agree before recording the tested `contentRevision`. Do not use `find` across fixture or stale target trees.

After PR #74 merges, record the resulting `main` SHA in HPA-536/PR closeout tracking for source provenance. No second documentation PR or compatibility tag is required.

## Implementation scope

Expected HPA-536 repository delta:

- the release-readiness execution record;
- the HPA-540 living-policy handoff;
- production/test files only if a concrete blocker is reproduced.

Out of scope: duplicate failed-Load tests, HPA-560 restructuring, Chapter 2/P3, controller certification, migration/golden-save infrastructure, thumbnail redesign, acquisition transaction resurrection, accessibility frameworks, and performance frameworks.

## Acceptance criteria

- [ ] readiness skeleton exists before long verification begins and is committed after each evidence phase;
- [ ] existing failed-Load transition contracts are reused;
- [ ] plain and all-features Rust surfaces pass;
- [ ] Analysis component tests plus Escape/GameShell owners pass;
- [ ] focused `analysis-beat85` run records its `run-result.json` and 1280x720 capture paths;
- [ ] physical-window, reduced-motion, keyboard, VoiceOver, and bounded five-cycle long-session observations are recorded — or explicitly deferred to post-closeout follow-up by an owner decision recorded in the readiness record before closeout (the 2026-08-26 deferral in `docs/superpowers/plans/2026-08-25-hpa-536-chapter-1-release-readiness.md` is that recorded decision); a deferral must be visible in the readiness record, never silent;
- [ ] any blocker follows the conditional reproduce -> owner regression -> minimal fix -> reverify path;
- [ ] full packaged registry is run once at closeout or an exact external run is cited;
- [ ] baseline uses the pinned tested manifest and canonical `SAVE_SCHEMA_VERSION + contentRevision` identity;
- [ ] merge result SHA is recorded in HPA-536/PR tracking after landing;
- [ ] no out-of-scope framework work is introduced.
