# Detective Gameplay Systems Implementation Plan

> **For agentic workers:** This is an umbrella delivery plan, not a single executable coding plan. Before implementing an epic, write and approve its focused specification and task-by-task TDD plan using `superpowers:writing-plans`; execute with `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Deliver the additive detective-reasoning program defined by `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md` through independently reviewable and testable milestones.

**Architecture:** The design specification is the sole normative contract. This plan owns sequencing, repository boundaries, ticket mapping, and verification gates. It does not redefine gameplay behavior.

**Tech Stack:** Rust, Tauri 2, SvelteKit static SPA, Svelte 5, TypeScript, Bun 1.3.1, Turborepo, Vitest, Testing Library for Svelte, WebdriverIO/Tauri e2e, compiler-authored Markdown/YAML/JSON.

This is a **multi-milestone platform program**, expected to land through many focused pull requests and potentially multiple release cycles. It must not be estimated, scheduled, or implemented as one feature branch.

The HPA mappings below are an execution snapshot as of 2026-07-21. Ticket identifiers may change; repository paths and design section references remain authoritative.

## 1. Execution rules

- Read the canonical design before each epic.
- Existing approved investigation/interrogation specifications remain authoritative for shipped behavior unless the design explicitly changes an integration point.
- Do not infer behavior from this plan when the design is more specific.
- Every epic receives a focused specification and executable TDD plan before code changes.
- Every epic lands as an independently reviewable PR.
- Existing generated Tauri resources remain untracked and are regenerated through `bun run scenes:compile`.
- Chapter 2 implementation remains blocked until the packaged Chapter 1 acceptance gate passes.
- External ticket IDs organize execution but do not define architecture.

## 2. Repository ownership map

### 2.1 Engine sequencing baseline

See design §6.2 for the dated repository baseline and the reason P0.0 is required. This plan intentionally does not repeat volatile line counts or file-size measurements.

The program begins with a scoped seam extraction rather than merely promising that `game/mod.rs` will not grow further.

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
  scenes/interrogation.rs    [existing — share extracted dialogue infrastructure]

  command_tx.rs              [new — EngineRollbackSnapshot and transaction delegate]
  dialogue.rs                [new — ordered segment lifecycle/history]
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

The P0.0 focused spec may refine module names, but it must preserve the design’s ownership boundaries and distinguish `EngineRollbackSnapshot` from persistent `SaveSnapshot`.

If a focused refactor later splits `scenes/interrogation.rs` into a directory module, that change belongs to its own reviewed implementation plan; this ownership map describes the current tree.

### 2.3 Compiler and shared-type boundary

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

`DialogueItem` remains outside `@lyra/scene-types`. Compiler AST, runtime JSON, editor layout, public view, and save state use the split defined in design §8.

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
  InterrogationView.svelte           [existing — extend only at explicit integration points]
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
| P0 — Persistence and Story State | Exact saves; catalog/state/provenance/unlocks/case file | Required P0.0 seams stable | Chapter 1 regression plus save/dialogue/acquisition round trips pass |
| P1 — Analysis Scene MVP | `analysis` compiles/runs with classify/order/threshold | P0 contracts stable | Compiler/Rust/UI fixture e2e and accessibility pass |
| P2 — Chapter 1 Vertical Slice | Beat 8.5 prepares request; hearing grants export | P1 complete | Full packaged Chapter 1 save/resume path passes |
| P3 — Chapter 2 Expansion | Map, media, compare, route, record use, response board | P2 accepted | Five-board Chapter 2 golden path passes |
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

Linear relations are the execution source for current blockers. This diagram records intended sequencing only.

---

## 5. P0.0 — Engine seam extraction

### Epic P0.0 — HPA-55: Extract GameEngine command, dialogue, and navigation seams

**Design reference:** §§6.2, 7.4.

**Deliverables**

- Rename the private rollback concept to `EngineRollbackSnapshot`.
- Extract a command-transaction delegate that snapshots, commits, and restores on failure.
- Extract ordered dialogue-segment lifecycle and dialogue-history finalization.
- Extract chapter/scene navigation and transition helpers.
- Establish acquisition-event and save integration entry points without implementing full P0 features prematurely.
- Keep `GameEngine` ownership and public command behavior stable.
- Reduce `game/mod.rs` to façade/orchestration for extracted concerns.

**Non-goals**

- No broad rewrite of all commands.
- No new gameplay behavior.
- No analysis scene or save format in this epic.
- No line-count-only refactor.

**Verification gate**

- Existing Rust unit/integration tests pass unchanged or with equivalent moved coverage.
- Existing Chapter 1 behavior remains identical.
- Dialogue history cannot be skipped by a new command path.
- Transaction rollback tests cover investigation and interrogation commands.
- Navigation/debug scene-selection behavior remains unchanged.
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
- Atomic, idempotent `setPrimaryObjective` state mutation and target validation.
- P0.3 consumes the P0.1-owned transition through the reveal contract; it does not implement a second objective-state mutation.
- Assertion origin and support-lineage hooks.
- Empty defaults for legacy chapters.

**Verification gate**

- Duplicate and ambiguous-reference fixtures.
- Invalid primary-objective target diagnostics.
- Atomic transition completes or replaces the current primary objective without violating the zero-or-one invariant.
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
- Atomic/idempotent reveal dispatch for story-state targets, delegating `setPrimaryObjective` to the P0.1-owned mutation.
- Positive fixed-point reachability over the resulting state transitions.
- No duplicate primary-objective mutation logic in the unlock/reachability layer.

**Verification gate**

- Existing unlock fixtures unchanged.
- Invalid count/cycle/unreachable tests.
- Fixed-point reachability accounts for P0.1-owned primary-objective transitions.
- Module/source tests prove P0.3 delegates objective mutation rather than changing objective state directly.
- No authored operation re-locks visible content.

### Epic P0.4 — HPA-129: Exact saves, ordered dialogue segments, and acquisitions

**Design reference:** §§7.4, 16.

**Deliverables**

- `SaveEnvelope` and persistent `SaveSnapshot`.
- Ordered dialogue segment origins, per-segment hashes, active segment, and cursor.
- Rust-owned acquisition events and acknowledgement.
- Atomic storage, backup rotation, Continue, and manual slots.
- Active-definition hashes and explicit migrations.
- A P0-owned generic resumable-state fixture that exercises incomplete mutable state without depending on the P1 analysis runtime.

**Verification gate**

- Round-trip every current runtime.
- Resume exact single- and multi-segment dialogue.
- Resume acquisition dialogue and display popup once.
- Resume the P0-owned generic fixture with its incomplete state, active definition reference/hash, and cursor restored exactly.
- Definition-change rejection/migration tests.
- Corrupt-primary fallback.
- Packaged save → title → Continue and overwrite flow.

Analysis-specific draft resume remains in P1.2, with packaged board/result-dialogue resume accepted in P2.2.

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
- Explicit compiler AST/runtime JSON/shared layout/public view/save-state split.
- Typed board union and card sources.
- Catalog references, hashes, and source-line diagnostics.
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

- `AnalysisSceneState`, availability, `activeBoardId`, and durable drafts.
- Explicit board selection and solved-board review.
- Generation-token protection.
- Atomic correct-resolution transaction.
- Ordered result-dialogue segments.
- Save integration through P0 contracts.

**Verification gate**

- Malformed/wrong/correct/repeated/stale tests.
- Full rollback on reveal failure.
- Re-enter/save exact draft restoration.
- Public views contain no solution.
- New commands use extracted transaction/dialogue delegates.

### Epic P1.3 — HPA-261: Accessible workbench

**Design reference:** §§8, 24.

**Deliverables**

- Shared host, board selector, progress, submit, hint, review, feedback.
- Pointer/keyboard parity.
- Focus/live-region/Escape/reduced-motion/1280×720 support.
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
- Accessible announcements and focus return.
- No hint mutates facts or solutions.

### Epic P1.6 — HPA-264: Request readiness and authority grants

**Design reference:** §§11.4, 19.

**Deliverables**

- Request-preparation objective/facts.
- Named authorizations and granting authority.
- Unlocks through `authorization_granted`.
- Reachable authority-grant validation.

**Verification gate**

- Request readiness and authorization are distinct.
- Wrong request remains retryable.
- Repeated rulings do not duplicate grants.
- Chapter 1 workbench cannot self-grant export.

---

## 8. P2 — Chapter 1 vertical slice

### Epic P2.1 — HPA-265: Beat 8.5 content integration

**Design reference:** §22.

**Files**

```text
Modify:  docs/stories_plan/chapter_1/chapter.md
Replace: docs/stories_plan/chapter_1/scene_8_5.md
Create:  docs/stories_plan/chapter_1/analysis_scene_8_5.md
```

**Deliverables**

- Classify/order/threshold boards from Chapter 1 V3.7.
- Required provenance/capability metadata.
- Facts and `prepare_narrow_lock_request` output.
- Existing hearing grants `narrow_lock_export`.
- Existing dialogue moved into analysis intro/outro.

**Verification gate**

- One Chapter 1 source root only.
- Same-source threshold fails clearly.
- Incorrect submissions reveal nothing.
- Incomplete boards and result dialogue resume exactly.
- Existing hearing/ending remain intact.

### Epic P2.2 — HPA-266: Packaged Chapter 1 acceptance gate

**Design reference:** §§22, 26.

**Required checks**

- `bun run scenes:compile`
- `bun run test`
- `bun run check`
- `bun run check:scripts`
- `bun run lint:all`
- full Rust test suite
- `bun run test:e2e`
- desktop smoke test using real Tauri IPC/resources/save path

**Acceptance scenarios**

- Save in every incomplete board and Continue exact draft.
- Save during multi-segment result/acquisition dialogue.
- Pending acquisition acknowledgement appears once.
- Request readiness is established in analysis.
- `narrow_lock_export` is granted only by the hearing.
- Case file, hints, history, audio, focus, Escape, and menu integration pass.

P3 cannot begin until this gate is accepted.

---

## 9. P3 — Chapter 2 expansion

### Epic P3.1 — HPA-267: Investigation-time record use

**Design reference:** §18.

**Deliverables**

- Compiler/runtime/public-view contract for authored target interactions.
- Evidence/statement selection and contextual feedback.
- Atomic correct reveals and non-destructive wrong use.
- Keyboard/pointer/focus coverage.

**Verification gate**

- Compiler fixtures cover character, topic, hotspot, and sublocation targets plus exact-record, proof-capability, procedural-status, and default-wrong branches.
- Rust tests prove correct use commits reveals once, while wrong or stale use neither mutates state nor consumes a record.
- Frontend tests cover keyboard/pointer selection, focus return, and contextual feedback.
- Run `bun run scenes:compile`, `bun run check:scripts`, `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, and `bun run --cwd apps/game test`.
- Existing investigation scenes with no authored record interactions remain behaviorally unchanged.

### Epic P3.2 — HPA-268: Compare and route templates

**Design reference:** §13.2.

**Deliverables**

- Compare authored layers/sources without spreadsheet editing.
- Route authored nodes/edges with access and time constraints.
- Outbound and return paths may differ.
- No freehand pathfinding.

**Verification gate**

- Valid/invalid compiler fixtures cover missing compare layers, unknown route nodes/edges, impossible access/time constraints, and distinct outbound/return solutions.
- Rust evaluator tests cover accepted and rejected comparisons/routes without chapter-specific branches.
- Frontend tests cover keyboard/pointer editing and accessible route/compare feedback.
- Save/load restores incomplete compare and route drafts exactly.
- Run `bun run scenes:compile`, `bun run check:scripts`, `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, and `bun run --cwd apps/game test`.

### Epic P3.3 — HPA-269: Derived-state staged map

**Design reference:** §21.2.

**Deliverables**

- Map owns only layout metadata.
- Visibility/current/completion derive from investigation sublocation state.
- No duplicate map progress.
- Existing sublocation navigation remains fallback.

**Verification gate**

- A staged-map fixture covers locked, visible, current, completed, mandatory, and optional sublocations using one underlying investigation state.
- Compiler fixtures reject missing, duplicate, or cross-scene sublocation references.
- Rust/public-view tests prove map status is derived and no separate durable map-progress collection exists.
- Frontend tests prove map selection changes the existing `currentSublocationId` and ordinary navigation remains available.
- Run `bun run scenes:compile`, `bun run check:scripts`, `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, and `bun run --cwd apps/game test`.

### Epic P3.4 — HPA-270: Frame strip and dual timecode

**Design reference:** §21.1.

**Deliverables**

- Authored still-frame sets.
- Absolute time and `S+` displayed distinctly.
- Selected frame can source analysis cards.
- No video decoding or arbitrary seek.

**Verification gate**

- Valid/invalid media fixtures cover frame ordering, asset references, absolute timestamps, `S+` offsets, and source/viewpoint metadata.
- Compiler and Rust serde tests reject malformed mappings and preserve semantic frame IDs.
- Frontend tests prove absolute time and `S+` render distinctly and never parse an offset as a clock time.
- Selected-frame state reconstructs after save/load and can produce the authored analysis-card source.
- Run `bun run scenes:compile`, `bun run check:scripts`, `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, and `bun run --cwd apps/game test`.
- No video decoder, arbitrary seek implementation, or new media-server dependency is introduced.

### Epic P3.5 — HPA-271: Chapter 2 five-board integration

**Design reference:** §23.

**Required boards**

1. sightline classification,
2. image-source comparison,
3. control-room reaction order,
4. outbound/return route,
5. person/capability resolution.

**Verification gate**

- ≤8 mandatory locations.
- Optional content is never the only mandatory source.
- Fan clips do not count as independent witnesses.
- QA proves route, not identity.
- Expired pass cannot explain return.
- Access, response control, and motive remain separate facts.
- All five boards resume exactly.
- Final hearing retains planned proof order.
- No Chapter 2-specific evaluator code.

---

## 10. P4 — Later-chapter platform

### Epic P4.1 — HPA-272: Chain and later-chapter fixtures

**Design reference:** §13.2.

**Deliverables**

- Reusable responsibility/causation chain template.
- Chapter 3 and Chapter 7 fixtures validate multiple contributors and omissions.
- No forced single-culprit model.

**Verification gate**

- Valid Chapter 3/7 fixtures cover multiple contributors, interventions, omissions, and consequences; invalid fixtures cover unknown/duplicate edges and incomplete required connections.
- Rust evaluator tests accept authored alternative edge sets where declared and reject false single-contributor simplifications.
- Frontend tests cover keyboard/pointer connection editing, review mode, and accessible error feedback.
- Save/load restores incomplete chain drafts exactly.
- Run `bun run scenes:compile`, `bun run check:scripts`, `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, and `bun run --cwd apps/game test`.

### Epic P4.2 — HPA-273: Authoring and editor support

**Deliverables**

- Repository-local analysis authoring skill after schema stability.
- Valid/invalid examples and audit guidance.
- Read-only editor preview before editing support.
- No duplicated answer-key logic in editor code.

**Verification gate**

- Every authoring example is exercised by the compiler fixture suite, including at least one invalid example per supported template family.
- The authoring skill and audit guidance reference the canonical schema and generated-resource rules rather than duplicating them.
- A read-only editor fixture renders shared layout/public data without loading accepted solutions or mutation rules.
- Source tests prove editor code contains no answer-key evaluator.
- Run `bun run scenes:compile`, `bun run check:scripts`, `bun run editor:build`, and `bun run lint:all`.

### Epic P4.3 — HPA-274: Archive and migration hardening

**Deliverables**

- People, locations, chronology, and social-response archive views as justified.
- Explicit migration registry and compatibility documentation.
- Golden save fixtures across supported schema/content revisions.
- No silent lossy migration of required state.

**Verification gate**

- Golden saves cover every supported schema/content revision and representative completed/incomplete story state.
- Migration tests prove each supported path is explicit, deterministic, and preserves required facts, objectives, authorizations, records, queues, and current-state references.
- Missing migration paths and incompatible definitions reject transactionally without modifying the active engine or source save.
- Archive-view tests expose only unlocked definitions and preserve neutral cross-chapter wording.
- Run `cargo test --manifest-path apps/game/src-tauri/Cargo.toml`, `bun run test`, `bun run check`, and `bun run lint:all`.

---

## 11. Cross-cutting verification

Every implementation PR runs the checks relevant to its layer and preserves existing subsystem behavior.

### Compiler changes

- `bun run scenes:compile`
- `bun run check:scripts`
- compiler fixture suite
- emitted JSON/Rust serde snapshots

### Rust changes

- `cargo fmt --check`
- `cargo clippy --all-targets --all-features -- -D warnings`
- `cargo test`
- transaction and exact-resume tests where applicable

### Frontend changes

- `bun run check`
- `bun run test`
- `bun run lint:all`
- keyboard/focus/Escape/reduced-motion coverage

### Acceptance slices

- packaged Tauri e2e,
- production resource compilation,
- stable production anchors,
- no browser-only substitute for desktop IPC behavior.

## 12. Program risks and mitigations

| Risk | Mitigation |
|---|---|
| Existing `game/mod.rs` absorbs more responsibilities | P0.0 blocks Rust-heavy integration and extracts shared seams first |
| Compiler/runtime/editor type drift | explicit AST/JSON/layout/view/save ownership split and serde snapshots |
| Save incompatibility after content edits | active-definition hashes and explicit migrations |
| Duplicate-source facts satisfy thresholds | source groups, support lineage, MVP record-only counting |
| Objective state becomes combinatorial | scalar `activePrimaryObjectiveId` and atomic transition |
| Optional map paths hide required facts | compiler reachability and alternate-source rules |
| Chapter-specific evaluators appear | reusable typed templates and source tests |
| Accessibility arrives late | acceptance requirements in every UI/template epic |
| Ticket links rot | design paths and section references remain normative; ticket map is dated |
| Program is treated as one feature | milestone gates, independent PRs, focused specs, multiple-release expectation |

## 13. Completion and handoff

The umbrella documents are complete when the design is approved and the ticket dependency graph matches this plan.

Implementation begins with focused P0.0 and P0 specifications—not with an all-program branch.

Current organizational tracking:

- Program parent: HPA-254
- Engine prerequisite: HPA-55
- Persistence: HPA-129
- Remaining epics: HPA-255–274

These identifiers are non-normative execution references.
