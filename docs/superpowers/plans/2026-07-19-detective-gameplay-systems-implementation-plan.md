# Detective Gameplay Systems Implementation Plan

> **For agentic workers:** This is the umbrella delivery plan, not a single executable coding plan. Before implementing an epic, write and approve its focused specification and a task-by-task plan using `superpowers:writing-plans`; execute with `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Deliver the detective-reasoning program defined by `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md` through independently reviewable, testable milestones.

**Architecture:** The design specification is the sole normative contract. This plan owns sequencing, repository boundaries, ticket mapping, and verification gates. It does not redefine gameplay behavior.

**Tech Stack:** Rust, Tauri 2, SvelteKit static SPA, Svelte 5, TypeScript, Bun 1.3.1, Turborepo, Vitest, Testing Library for Svelte, WebdriverIO/Tauri e2e, compiler-authored Markdown/YAML/JSON.

## 1. Execution rules

- Read the canonical design before each epic.
- Do not infer a behavior from this plan when the design is more specific.
- Every epic receives a focused spec and executable TDD plan before code changes.
- Every epic lands as an independently reviewable PR.
- Existing generated Tauri resources remain untracked and are regenerated through `bun run scenes:compile`.
- Chapter 2 implementation remains blocked until the packaged Chapter 1 acceptance gate passes.
- External ticket IDs organize execution but do not define architecture.

## 2. Current repository baseline

### 2.1 Engine debt that changes sequencing

`apps/game/src-tauri/src/game/mod.rs` is currently roughly 7,350 lines / 288 KB. It already owns substantial command, transaction, dialogue, navigation, history, reveal, and view behavior.

The program must therefore begin with a scoped seam extraction rather than merely promising not to grow this file further.

### 2.2 Existing versus new Rust paths

```text
apps/game/src-tauri/src/game/
  mod.rs                     [existing — reduce to façade/orchestration]
  schema.rs                  [existing — extend and split where focused specs require]
  state.rs                   [existing — extend and split]
  view.rs                    [existing — extend and split]
  unlock.rs                  [existing — extend]
  reveals.rs                 [existing — extend]
  loader.rs                  [existing — extend for catalog/analysis resources]
  scenes/mod.rs              [existing — add Analysis variant]
  scenes/linear.rs           [existing]
  scenes/investigation.rs    [existing — share extracted dialogue infrastructure]
  scenes/interrogation/      [existing — share extracted dialogue infrastructure]

  command_tx.rs              [new — EngineRollbackSnapshot and transactional delegate]
  dialogue.rs                [new — ordered segment queue lifecycle/history]
  navigation.rs              [new — chapter/scene transition helpers]
  story_catalog.rs           [new]
  story_state.rs             [new]
  provenance.rs              [new]
  support_lineage.rs         [new]
  acquisition_events.rs      [new]

  save/
    mod.rs                   [new]
    schema.rs                [new — SaveSnapshot/SaveEnvelope]
    storage.rs               [new]
    compatibility.rs         [new]
    migrations.rs            [new]

  scenes/analysis/
    mod.rs                   [new]
    state.rs                 [new]
    view.rs                  [new]
    feedback.rs              [new]
    classify.rs              [new]
    order.rs                 [new]
    threshold.rs             [new]
    compare.rs               [new in P3]
    route.rs                 [new in P3]
    chain.rs                 [new in P4]
```

The focused P0.0 spec may refine names, but it must preserve the design’s ownership boundaries and distinguish `EngineRollbackSnapshot` from persistent `SaveSnapshot`.

### 2.3 Compiler/shared type boundary

```text
packages/scene-types/src/index.ts
  [existing — add only byte-identical layout/index values]

packages/scripts/compile-scenes/
  types.ts                   [existing — compiler AST/runtime JSON types]
  parser-chapter.ts          [existing — recognize analysis scenes]
  parser-unlock.ts           [existing — extend positive grammar]
  emitter.ts                 [existing — emit catalog and scene JSON]
  parser-analysis.ts         [new]
  story-catalog.ts           [new]
  validator-analysis.ts      [new]
  reachability.ts            [new]
  definition-hash.ts         [new]
```

`DialogueItem` remains outside `@lyra/scene-types`. The compiler, Rust runtime, editor layout, public view, and save state use the type split defined in design §8.

### 2.4 Frontend ownership

```text
apps/game/src/lib/state/
  types.ts                           [existing — extend public views]
  game-client.svelte.ts              [existing — extend semantic commands]
  save-client.svelte.ts              [new]

apps/game/src/lib/components/
  AnalysisWorkbench.svelte           [new]
  CaseFilePanel.svelte               [new]
  SaveLoadPanel.svelte               [new]
  InvestigationMap.svelte            [new in P3]
  MediaEvidenceViewer.svelte         [new in P3]
  InvestigationSceneSurface.svelte   [existing — extend in P3]
  InterrogationView.svelte           [existing — extend as required]
  analysis/                           [new focused components]

apps/game/src/routes/+page.svelte     [existing — route modes/mount overlays]
apps/game/e2e-tauri/                  [existing — extend production tests]
```

### 2.5 Chapter 1 authored source

Chapter 1 currently lives only under `docs/stories_plan/chapter_1/`.

P2 modifies exactly:

```text
Modify:  docs/stories_plan/chapter_1/chapter.md
Replace: docs/stories_plan/chapter_1/scene_8_5.md
Create:  docs/stories_plan/chapter_1/analysis_scene_8_5.md
```

Do not create a duplicate `chapter_1` under `static/stories_plan/`.

## 3. Milestone sequence

| Milestone | Outcome | Entry gate | Exit gate |
|---|---|---|---|
| P0.0 — Engine Seam Extraction | Existing monolith exposes safe transaction/dialogue/navigation seams | Design approved | Existing gameplay tests pass through delegated modules |
| P0 — Persistence and Story State | Exact saves; catalog/state/provenance/unlocks/case file | P0.0 required seams stable | Existing Chapter 1 regression plus save/dialogue/acquisition round trips pass |
| P1 — Analysis Scene MVP | `analysis` compiles/runs with classify/order/threshold | P0 contracts stable | Compiler/Rust/UI fixture e2e and accessibility pass |
| P2 — Chapter 1 Vertical Slice | Beat 8.5 prepares request; hearing grants export | P1 complete | Full packaged Chapter 1 save/resume path passes |
| P3 — Chapter 2 Expansion | Map, media, compare, route, record use, reaction board | P2 accepted | Five-board Chapter 2 golden path passes |
| P4 — Later-Chapter Platform | Chain, richer archive, authoring/editor, migration hardening | P3 stable | Later-chapter fixtures use shared runtime only |

## 4. Dependency map

```text
P0.0
HPA-55 Engine seam extraction
   ├─ blocks HPA-129 save/runtime integration
   ├─ blocks Rust portions of HPA-255 and HPA-256
   └─ blocks HPA-260 analysis runtime

Compiler-only contract work may proceed while P0.0 is underway.

P0
HPA-255 Global catalog/story state ───────┐
HPA-256 Provenance/support lineage ───────┼─ HPA-257 Unlock/reveal/reachability
HPA-129 Save/dialogue/acquisition ─────────┼─ HPA-258 Case file/recap
                                            └─ P1

P1
HPA-259 Analysis compiler contract
    ↓
HPA-260 Rust analysis runtime
    ↓
HPA-261 Workbench UI
    ↓
HPA-262 Classify/order/threshold
    ├─ HPA-263 Feedback/hints
    └─ HPA-264 Request/authorization gates

P2
HPA-265 Chapter 1 content integration
    ↓
HPA-266 Packaged Chapter 1 acceptance gate

P3 — all blocked by HPA-266
HPA-267 Investigation record use
HPA-268 Compare/route templates
HPA-269 Derived-state staged map
HPA-270 Frame strip/dual timecode
    └─ HPA-271 Chapter 2 integration

P4
HPA-272 Chain/later fixtures
HPA-273 Authoring/editor support
HPA-274 Archive/migration hardening
```

Linear relations are the execution source for current blockers. This diagram records intended sequencing.

---

## 5. P0.0 — Engine seam extraction

### Epic P0.0 — HPA-55: Extract GameEngine command, dialogue, and navigation seams

**Design reference:** §§6.2, 7.4.

**Deliverables**

- Rename the private rollback concept to `EngineRollbackSnapshot`.
- Extract a command-transaction delegate that snapshots, commits, and restores on failure.
- Extract ordered dialogue-segment queue lifecycle and dialogue-history finalization.
- Extract chapter/scene navigation and transition helpers.
- Establish acquisition-event and save integration entry points without implementing the full P0 features prematurely.
- Keep `GameEngine` ownership and public command behavior stable.
- Reduce `game/mod.rs` to façade/orchestration for the extracted concerns.

**Non-goals**

- No broad rewrite of all commands.
- No new gameplay behavior.
- No analysis scene or save format in this epic.
- No line-count-only refactor.

**Verification gate**

- Existing Rust unit/integration tests pass unchanged or with equivalent moved-test coverage.
- Existing Chapter 1 full-playthrough behavior remains identical.
- Dialogue history cannot be skipped by a new command path because history finalization is centralized.
- Transaction rollback tests cover investigation and interrogation commands.
- Navigation/debug scene selection behavior remains unchanged.
- `cargo fmt`, `cargo clippy`, and `cargo test` pass.

---

## 6. P0 — Persistence and Story State

### Epic P0.1 — HPA-255: Global catalog and story state

**Design reference:** §§7.3, 9, 11.

**Deliverables**

- Generated global story catalog.
- Global/local ID validation and qualified board refs.
- Fact/question/objective/authorization definitions and progress.
- Structural `activePrimaryObjectiveId` representation.
- Atomic `setPrimaryObjective` reveal.
- Assertion origin and support lineage hooks.
- Empty defaults for legacy chapters.

**Verification gate**

- Duplicate and ambiguous-reference compiler fixtures.
- Invalid primary-objective target diagnostics.
- Existing Chapter 1 compiles unchanged.
- Cross-scene/chapter state tests.
- Runtime structurally permits zero or one primary objective.

### Epic P0.2 — HPA-256: Provenance and support lineage

**Design reference:** §§10–11.1.

**Deliverables**

- Shared orthogonal `CaseRecordProvenance`.
- Neutral unspecified defaults.
- Immutable supersession chains.
- Supporting record/fact lineage and transitive closure.
- Compiler errors for missing required metadata.

**Verification gate**

- Parser/serde/view coverage for all dimensions.
- Legacy visual regression.
- Many wall-derived clips count as one source.
- Superseded records remain inspectable.

### Epic P0.3 — HPA-257: Monotonic unlocks and reachability

**Design reference:** §15.

**Deliverables**

- Positive story-state predicates and `at_least`.
- No generic `not`.
- Atomic/idempotent reveals, including primary-objective transition.
- Positive fixed-point reachability.

**Verification gate**

- Existing unlock fixtures unchanged.
- Invalid count/cycle/unreachable tests.
- Invalid objective-transition target tests.
- No authored operation re-locks visible content.

### Epic P0.4 — HPA-129: Exact saves, ordered dialogue segments, and acquisitions

**Design reference:** §§7.4, 16.

**Deliverables**

- `SaveEnvelope` and persistent `SaveSnapshot`.
- Ordered dialogue segment origins, per-segment hashes, active segment and cursor.
- Rust-owned acquisition events and acknowledgement.
- Atomic storage, backup rotation, Continue, manual slots.
- Active-definition hashes and explicit migrations.

**Verification gate**

- Round-trip every current runtime.
- Resume exact single- and multi-segment dialogue.
- Resume acquisition dialogue and display popup once.
- Resume an incomplete analysis fixture once P1 supplies it.
- Definition-change rejection/migration tests.
- Corrupt-primary fallback.
- Packaged save → title → Continue and overwrite flow.

### Epic P0.5 — HPA-258: Case file and recap

**Design reference:** §17.

**Deliverables**

- Objective, Evidence, Statements, Facts, Questions, Authorizations.
- Provenance/proof-limit/supersession details.
- Existing re-examination preserved.
- Primary objective in HUD/save/Continue summary.

**Verification gate**

- No locked-definition spoilers.
- Keyboard/focus/Escape coverage.
- Legacy records visually unchanged.
- Save/load restores every section.

---

## 7. P1 — Analysis Scene MVP

### Epic P1.1 — HPA-259: Analysis compiler contract

**Design reference:** §§8, 12–15.

**Deliverables**

- `analysis_scene_<K>.md` recognition.
- Explicit split between compiler AST, runtime JSON, shared layout, public view, and save state.
- Typed board union and sources.
- Catalog references, definition hashes, source-line diagnostics.
- Fixed-point validation for boards/cards/reveals/grants.

**Verification gate**

- Valid classify/order/threshold fixtures.
- Invalid duplicate/reference/threshold/cycle/provenance fixtures.
- `DialogueItem` remains outside `@lyra/scene-types`.
- Emitted JSON passes Rust serde snapshots.
- Existing scene types compile unchanged.

### Epic P1.2 — HPA-260: Rust analysis runtime

**Design reference:** §§12–14.

**Deliverables**

- `AnalysisSceneState`, board availability, `activeBoardId`, durable drafts.
- Explicit selection and solved-board review.
- Generation-token protection.
- Atomic correct-resolution transaction.
- Ordered result dialogue segments.
- Save integration through P0 contracts.

**Verification gate**

- Malformed/wrong/correct/repeated/stale tests.
- Full rollback on reveal failure.
- Re-enter/save exact draft restoration.
- Public views contain no solution.

### Epic P1.3 — HPA-261: Accessible workbench

**Design reference:** §§8, 24.

**Deliverables**

- Shared host, board selector, progress, submit, hint, review, feedback.
- Pointer/keyboard parity.
- Focus/live region/Escape/reduced-motion/1280×720 support.
- Typed semantic commands and page routing.

**Verification gate**

- Keyboard-only fixture completion.
- Source tests prove no Svelte correctness rules.
- Existing acquisition/dialogue/menu/audio layering remains correct.

### Epic P1.4 — HPA-262: MVP templates

**Design reference:** §13.1.

**Deliverables**

- Classify, order, and threshold compiler/runtime/UI support.
- Threshold source independence and metadata constraints.
- Facts/case notes excluded from independent-source counting.

**Verification gate**

- Valid/invalid fixtures and Rust evaluators.
- Same-source rejection.
- Exact save restoration.
- Pointer/keyboard draft parity.

### Epic P1.5 — HPA-263: Feedback and hints

**Design reference:** §20.

**Deliverables**

- Deterministic feedback precedence.
- Four authored hint levels.
- Failure/hint persistence without draft loss.

**Verification gate**

- Overlapping-rule precedence tests.
- Accessible announcements/focus return.
- No hint mutates facts or solutions.

### Epic P1.6 — HPA-264: Request and authorization gates

**Design reference:** §§11.4, 19.

**Deliverables**

- Request readiness distinct from institutional authorization.
- Granting authority in catalog/view.
- Authority-event grants and positive authorization gates.

**Verification gate**

- Request and grant are separate state transitions.
- Repeated ruling is idempotent.
- Compiler rejects missing authority-grant path.

---

## 8. P2 — Chapter 1 Vertical Slice

### Epic P2.1 — HPA-265: Beat 8.5 integration

**Design reference:** §22 and Chapter 1 V3.7.

**Files**

```text
Modify:  docs/stories_plan/chapter_1/chapter.md
Replace: docs/stories_plan/chapter_1/scene_8_5.md
Create:  docs/stories_plan/chapter_1/analysis_scene_8_5.md
```

**Deliverables**

- Classify evidence packages.
- Order `Event-1841` through `Event-1844`.
- Select two independent lock contradictions.
- Assert the four design facts.
- Complete `prepare_narrow_lock_request`.
- Hearing grants `narrow_lock_export`.
- Required provenance metadata on referenced records.

**Verification gate**

- No duplicate chapter source root.
- Scene compile succeeds without required-metadata warnings.
- Same-source pair fails.
- Hearing, not workbench, grants export.
- Existing culprit, timeline, audio, assets, and proof order remain intact.

### Epic P2.2 — HPA-266: Packaged acceptance gate

**Design reference:** §§22, 26.

**Deliverables**

- Rust full playthrough through analysis and hearing.
- Packaged Tauri e2e for all boards.
- Save/Continue from each incomplete draft.
- Resume multi-segment result/acquisition dialogue.
- Verify feedback, hint, case file, history, audio, focus, Escape, menus.

**Exit commands**

```bash
bun run scenes:compile
bun run test
bun run check
bun run check:scripts
bun run lint:all
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run test:e2e
```

Also perform a desktop smoke test using real Tauri IPC/resources/save storage.

P3 remains blocked until this gate is accepted.

---

## 9. P3 — Chapter 2 Expansion

### HPA-267 — Investigation-time record use

Design §18. Add compiler/Rust/UI support for authored record interactions on characters, topics, hotspots, and sublocation points.

### HPA-268 — Compare and route templates

Design §13.2. Add reusable compare/route schemas, evaluators, public views, accessible UI, feedback, and save support.

### HPA-269 — Derived-state staged map

Design §21.2. Author only map presentation metadata; derive visible/current/completed state from investigation sublocations.

### HPA-270 — Static frame strips and dual time

Design §21.1. Preserve `S+` as authored relative labels distinct from clock time; no video codec/seek dependency.

### HPA-271 — Five-board Chapter 2 integration

Design §23 and Chapter 2 V0.7. Integrate sightline, image source, control-room order, outbound/return route, and person/capability boards with ≤8 mandatory locations.

**P3 exit gate**

- Source-group independence works.
- Control-room reaction is reconstructed without collective dishonesty/stupidity.
- Outbound and return routes are distinct and constrained.
- Access/control/motive facts remain separate.
- Lead material is reacquired before hearing use.
- No Chapter 2-specific evaluator code.
- Compiler/Rust/frontend/save/accessibility/Tauri tests pass.

---

## 10. P4 — Later-Chapter Platform

### HPA-272 — Chain and later fixtures

Add the `chain` template and Chapters 3/6/7 readiness fixtures without bespoke scene modes.

### HPA-273 — Authoring/editor support

Add writer skills and read-only editor previews after the runtime contracts prove stable. Keep `DialogueItem` out of shared layout types.

### HPA-274 — Archive and migration hardening

Expand the archive only where usability supports it; commit historical save fixtures and explicit released-schema/content migrations.

---

## 11. Cross-program risks and gates

| Risk | Gate |
|---|---|
| Existing `game/mod.rs` monolith absorbs new behavior | P0.0 extraction blocks Rust-heavy P0/P1 work |
| Compiler/runtime/editor type drift | Explicit five-shape analysis type boundary + serde snapshots |
| Objective uniqueness becomes expensive model checking | Scalar `activePrimaryObjectiveId`; compiler validates transition targets only |
| Save resumes wrong authored dialogue | Ordered segment origins + hashes + cursor + migration tests |
| Acquisition popup lost/replayed | Rust-owned acknowledgement event + packaged resume test |
| Facts launder duplicate sources | MVP threshold accepts evidence/statements only |
| Optional branches hide mandatory proof | Fixed-point reachability + Chapter 2 alternate-route fixtures |
| Chapter 2 expands framework too early | HPA-266 blocks all P3 work |
| Frontend gains answer keys | Source tests and public-view contract |
| Documentation contracts drift | Design is sole normative source; this plan references section numbers |

## 12. Final program verification

Before declaring the program complete:

```bash
bun run scenes:compile
bun run test
bun run check
bun run check:scripts
bun run lint:all
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run test:e2e
```

Additionally verify:

- packaged desktop smoke flow,
- save migration fixtures,
- keyboard-only analysis completion,
- screen-reader announcements,
- 1280×720 layouts,
- reduced motion,
- Chapter 1 complete proof order,
- Chapter 2 five-board golden path,
- at least one later-chapter shared-template fixture.

## Tracking (non-normative)

At the time of writing, the program is organized under Linear HPA-254 and its child issues. Tracking identifiers may change without changing this plan’s repository paths or the design contract.