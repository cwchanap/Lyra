# Detective Gameplay Systems High-Level Implementation Plan

> **For agentic workers:** This is the umbrella delivery plan, not a single executable coding plan. Before implementing any epic, write and approve a focused design and a task-by-task implementation plan using `superpowers:writing-plans`; execute it with `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Add persistence and a reusable detective-reasoning layer so players organize records into explicit facts, prepare justified procedural requests, receive authority-granted access, and play the Chapter 1/2 plans without chapter-specific correctness logic.

**Architecture:** Preserve Markdown → compiler → global story catalog/scene JSON → Rust `GameEngine` → typed Svelte presentation. Rust owns durable state, transactions, accepted solutions, stable dialogue/acquisition resume, and save compatibility. Chapter 1 is the acceptance gate before Chapter 2 expands the template and UI contract.

**Tech Stack:** Rust, Tauri 2, SvelteKit static SPA, Svelte 5 runes, TypeScript 5.6, Bun 1.3.1, Turborepo, Vitest, Testing Library for Svelte, WebdriverIO/Tauri e2e, compiler-authored Markdown/YAML/JSON resources.

**Canonical design:** `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`

**Normative decisions:** `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-decision-locks.md`

**Linear parent:** HPA-254

## 1. Global constraints

- PR #23/HPA-254 are the single program source of truth; PR #24/HPA-239 are superseded.
- Keep the SvelteKit application in static SPA mode; do not add SSR, endpoints, or a Node server.
- Rust owns durable game state, correctness, accepted solutions, transactions, queue/acquisition resume, and save snapshots.
- Svelte receives public views and sends semantic IDs; it never contains answer keys.
- Markdown remains the authored source of truth; generated resources are never hand-edited.
- Existing `linear`, `investigation`, and `interrogation` content continues to compile and play without migration.
- Progression remains monotonic; do not add generic `not` or rules that re-lock content.
- Definitions and mutable state remain separate through a global story catalog.
- Legacy case records use unspecified provenance defaults and cannot silently satisfy metadata-dependent rules.
- Lead/reacquired/exhibit transitions create immutable superseding records.
- Exactly one primary objective is active.
- Analysis request readiness and institutional authorization are separate events.
- Every drag interaction has a keyboard/assistive-technology path.
- Every implementation epic lands as an independently reviewable PR with focused tests.
- Chapter 2 implementation remains blocked until the Chapter 1 packaged Tauri acceptance flow passes.

## 2. Narrative precedence

1. Chapter 1 Final Writing Plan V3.7.
2. Chapter 2 Plan V0.7 Timecode / Control-Room Reaction Lock.
3. Story Bible V6.5 Canon Sync Patch.
4. Story Bible V6.4.
5. Older notes.

## 3. Program ownership map

### 3.1 Compiler and shared contracts

Expected ownership:

- `packages/scene-types/src/index.ts` — byte-identical scene index, map layout, and editor/runtime shared values.
- `packages/scripts/compile-scenes/types.ts` — compiler AST and emitted JSON types.
- `packages/scripts/compile-scenes/parser-analysis.ts` — analysis Markdown parser.
- focused compiler modules for story catalog, analysis validation, reachability, provenance, map/media, and definition hashes.
- `packages/scripts/compile-scenes/parser-chapter.ts` — `analysis_scene_*.md` recognition.
- `packages/scripts/compile-scenes/emitter.ts` — scene resources plus global story catalog.
- fixtures/snapshots for valid and invalid cross-layer contracts.

### 3.2 Rust engine

Expected focused modules:

```text
apps/game/src-tauri/src/game/
  story_catalog.rs
  story_state.rs
  provenance.rs
  support_lineage.rs
  acquisition_events.rs
  unlock.rs
  reveals.rs
  save/
    mod.rs
    schema.rs
    storage.rs
    compatibility.rs
    migrations.rs
  scenes/
    analysis/
      mod.rs
      state.rs
      view.rs
      feedback.rs
      classify.rs
      order.rs
      threshold.rs
      compare.rs
      route.rs
      chain.rs
```

`game/mod.rs` remains orchestration; it must not absorb template validators, migration logic, or media/map rules.

### 3.3 Svelte frontend

Expected focused components/state:

```text
apps/game/src/lib/state/
  save-client.svelte.ts
  types.ts
  game-client.svelte.ts

apps/game/src/lib/components/
  AnalysisWorkbench.svelte
  CaseFilePanel.svelte
  SaveLoadPanel.svelte
  InvestigationMap.svelte
  MediaEvidenceViewer.svelte
  analysis/
    AnalysisCard.svelte
    AnalysisFeedback.svelte
    ClassifyBoard.svelte
    OrderBoard.svelte
    ThresholdBoard.svelte
    CompareBoard.svelte
    RouteBoard.svelte
    ChainBoard.svelte
```

The actual focused specs may split names further, but responsibility may not move from Rust to Svelte.

### 3.4 Authoring/editor

- `.claude/skills/writing-analysis-scene/SKILL.md` after the Markdown contract stabilizes.
- investigation/interrogation skills updated for story-state and record interaction references.
- layout editor reads map/analysis/provenance data after Chapter 2 proves the runtime contract.
- authored Markdown remains source of truth; interactive board authoring is deferred.

## 4. Milestone sequence

| Milestone | Outcome | Entry gate | Exit gate |
|---|---|---|---|
| P0 — Persistence and Story State | Saves are exact; catalog/state/provenance/unlocks/case file exist | Umbrella revision approved | Existing Chapter 1 regression + save/queue/acquisition round trips pass |
| P1 — Analysis Scene MVP | `analysis` compiles/runs with classify/order/threshold | P0 contracts stable | Compiler/Rust/UI fixture e2e and accessibility pass |
| P2 — Chapter 1 Vertical Slice | Beat 8.5 prepares request; hearing grants export | P1 complete | Full Chapter 1 packaged Tauri save/resume flow passes |
| P3 — Chapter 2 Expansion | Map, media, compare, route, control-room order, item use | P2 accepted | Five-board Chapter 2 golden-path prototype passes |
| P4 — Later-Chapter Platform | Chain, richer archive, authoring/editor, migrations | P3 stable | Later-chapter fixtures use shared runtime only |

## 5. Dependency map

```text
P0
HPA-255 Story catalog/state ──────────────┐
HPA-256 Provenance/support lineage ───────┼─ HPA-257 Monotonic unlock/reveal
                                          │
HPA-129 Save/queue/acquisition ───────────┼─ HPA-258 Case file/recap
                                          │
                                          └─ P1

P1
HPA-259 Analysis compiler/reachability
            ↓
HPA-260 Rust runtime/transactions
            ↓
HPA-261 Workbench UI
            ↓
HPA-262 Classify/order/threshold
            ├─ HPA-263 Feedback/hints
            └─ HPA-264 Procedure request/authorization gates

P2
HPA-265 Chapter 1 content integration
            ↓
HPA-266 Chapter 1 packaged acceptance gate

P3 (all blocked by HPA-266)
HPA-267 Investigation record use
HPA-268 Compare/route templates
HPA-269 Derived-state staged map
HPA-270 Frame strip/dual timecode
            └───────────────┐
                            ↓
HPA-271 Chapter 2 five-board integration

P4
HPA-272 Chain/later fixtures
HPA-273 Authoring/editor support
HPA-274 Archive/migration hardening
```

Focused Linear relations are the execution source of truth. This diagram records intended sequencing.

---

## 6. P0 — Persistence and Story State

### Epic P0.1 — HPA-255: Global story catalog and durable story state

**Goal:** Separate immutable definitions from mutable facts/questions/objectives/authorizations.

**Deliverables**

- Generated global story catalog.
- Game-global ID validation.
- Qualified references for local scene/board objects.
- `FactDefinition/State`, `QuestionDefinition/State`, `ObjectiveDefinition/State`, and `AuthorizationDefinition/State`.
- Exactly one primary active objective.
- Assertion origin and supporting record/fact lineage.
- Empty defaults for legacy chapters.

**Verification gate**

- Duplicate/global/local-reference compiler fixtures.
- Existing Chapter 1 compiles unchanged.
- Cross-scene and cross-chapter state persistence tests.
- Save round trip through catalog definitions.

### Epic P0.2 — HPA-256: Case-record provenance and support lineage

**Goal:** Give evidence/statements explicit independent dimensions and immutable supersession chains.

**Deliverables**

- Shared `CaseRecordProvenance`.
- Source kind, representation layer, procedure, completeness, confidence, source group, proof capabilities, and supersession.
- Unspecified neutral legacy defaults.
- Immutable lead → reacquired → exhibit chains.
- Transitive support closure for facts.
- Compiler errors when metadata-dependent rules reference unspecified records.

**Verification gate**

- Parser/serde/view tests for every enum.
- Legacy visual regression.
- Multiple wall-derived clips count as one source.
- Superseded records remain inspectable.

### Epic P0.3 — HPA-257: Monotonic unlock, reveal, and fixed-point reachability

**Goal:** Add positive story-state predicates and deterministic reachability.

**Deliverables**

- `fact_asserted`, `question_resolved`, `objective_completed`, qualified analysis board/scene completion, `authorization_granted`.
- `and`, `or`, and `at_least` only; no generic `not`.
- Atomic idempotent reveal targets.
- Positive fixed-point reachability diagnostics.

**Verification gate**

- Existing unlock fixtures unchanged.
- Invalid count/cycle/unreachable-required/grant-path tests.
- No authored operation can re-lock already visible content.

### Epic P0.4 — HPA-129: Save/load, stable queues, durable acquisitions, and Continue

**Goal:** Resume exact authoritative state across every current and planned durable mode.

**Deliverables**

- One autosave, previous-autosave backup, three manual slots.
- Versioned `SaveEnvelope` and mutable snapshot.
- Stable dialogue queue origins + queue definition hashes + cursors.
- Rust-owned durable acquisition events with acknowledgement state.
- Definition hashes for active/incomplete scenes/boards/queues.
- Atomic writes, transactional loads, explicit schema/content migrations.
- Continue selects newest valid save.

**Verification gate**

- Round-trip every current runtime.
- Save during dialogue and restore exact queue item.
- Save during acquisition dialogue and still show pending popup once.
- Save during incomplete analysis fixture and restore exact draft.
- Definition-change incompatibility tests.
- Corrupt primary fallback to backup.
- Tauri save → title → Continue and manual overwrite.

### Epic P0.5 — HPA-258: Case file, objective, authorization, and recap

**Goal:** Present what the player owns, has proved, is asking for, and is still investigating.

**Deliverables**

- Objective, Evidence, Statements, Facts, Questions, and Authorizations sections.
- Provenance/proof-limit/supersession detail.
- Preserve re-examination.
- Primary objective in HUD and save/Continue summaries.
- Neutral cross-chapter question treatment.

**Verification gate**

- No locked definition spoilers.
- Keyboard/focus/Escape coverage.
- Legacy evidence remains visually unchanged.
- Save/load restores each section and recap.

---

## 7. P1 — Analysis Scene MVP

### Epic P1.1 — HPA-259: Analysis Markdown, compiler, and reachability contract

**Deliverables**

- `analysis_scene_<K>.md` manifest recognition.
- Typed board union and card sources.
- Global catalog references rather than scene-owned global definitions.
- Valid fixtures for classify/order/threshold.
- Definition hashes.
- Fixed-point validation for required boards/cards/reveals/grants.

**Verification gate**

- Source-line diagnostics for duplicates, missing references, impossible thresholds, cycles, and unspecified required provenance.
- Emitted JSON accepted by Rust serde tests.
- Existing scene types unchanged.

### Epic P1.2 — HPA-260: Rust analysis runtime and atomic resolution

**Deliverables**

- `AnalysisSceneState` with available boards, `activeBoardId`, durable drafts, failures, hints, resolution.
- Explicit board selection.
- Completed-board read-only review.
- Generation-token protection.
- Atomic correct-resolution transaction.
- Stable result-dialogue origins.
- Save snapshot integration.

**Verification gate**

- Malformed/wrong/correct/repeated/stale-action tests.
- Transaction rollback on failed reveal.
- Leave/re-enter and save/load exact draft restoration.
- Public views contain no accepted solution.

### Epic P1.3 — HPA-261: Accessible analysis workbench

**Deliverables**

- Shared host, board selector, progress, submit, hint, back, review, and feedback surfaces.
- Pointer/keyboard parity.
- Focus restoration, live regions, Escape layering, reduced motion, 1280×720 support.
- Typed command wrappers and page mode routing.

**Verification gate**

- Keyboard-only fixture completion.
- Source tests prove no Svelte correctness rules.
- Acquisition/dialogue/menu/audio layering remains correct.

### Epic P1.4 — HPA-262: Classify, order, and threshold

**Deliverables**

- `classify`: required cards assigned once to one accepted group.
- `order`: canonical total order plus fixed anchors.
- `threshold`: evidence/statement eligibility, counts, source-group independence, capability/procedure requirements.
- Facts/case notes excluded from independent-source counting in MVP.

**Verification gate**

- Valid/invalid fixtures and Rust evaluators.
- Same-source selection fails.
- Drafts save/restore.
- Pointer/keyboard paths produce identical Rust drafts.

### Epic P1.5 — HPA-263: Contextual feedback and hints

**Deliverables**

- Exact → procedure → duplicate source → missing capability → structural → default precedence.
- Four-level deliberate hint ladder.
- Persistent failure/hint state.
- Draft preservation after wrong submission.

**Verification gate**

- Precedence tests.
- Time-not-identity, same-wall-source, and lead-not-exhibit examples.
- Accessible announcement/focus tests.

### Epic P1.6 — HPA-264: Procedure request and authority-grant gates

**Deliverables**

- Named authorizations and authority metadata.
- Analysis establishes request readiness/objective completion.
- Hearing/story authority event grants authorization.
- Retryable reasoned denial.
- Reachable grant-path compiler checks.

**Chapter 1 acceptance**

- Beat 8.5 completes `prepare_narrow_lock_request`.
- Hearing grants `narrow_lock_export` once.

---

## 8. P2 — Chapter 1 Vertical Slice

### Epic P2.1 — HPA-265: Beat 8.5 content integration

**Migration**

- Replace playable `scene_8_5.md` with `analysis_scene_8_5.md`.
- Move transition dialogue into intro/outro.

**Boards**

1. Classify three evidence packages.
2. Order `Event-1841` through `Event-1844`.
3. Select two independent lock contradictions.

**Facts**

- `miyake_known_lies_are_unrelated_to_murder`
- `earlier_external_entry_exists`
- `merge_time_is_not_event_time`
- `two_independent_lock_contradictions_identified`

**Objective**

- complete `prepare_narrow_lock_request`

**Hearing**

- grant `narrow_lock_export` after the authority accepts the argument.

**Verification gate**

- Chapter 1 canon/proof order/assets/audio remain intact.
- Same-source contradictions fail clearly.
- No export authorization exists before hearing approval.

### Epic P2.2 — HPA-266: Packaged acceptance gate

**Required coverage**

- Full Rust playthrough.
- Packaged Tauri path through all boards and final hearing.
- Save/resume each incomplete board.
- Save/resume result dialogue and pending acquisition acknowledgement.
- Wrong same-source feedback.
- Request readiness followed by hearing grant.
- Case file, hint, dialogue history, audio, focus, Escape, and menu integration.

**Gate commands**

```bash
bun run scenes:compile
bun run test
bun run check
bun run check:scripts
bun run lint:all
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run test:e2e
```

P3 remains blocked until this ticket is Done.

---

## 9. P3 — Chapter 2 Expansion

### Epic P3.1 — HPA-267: Evidence/statement use during investigation

- Authored targets: character, topic, hotspot, sublocation interaction point.
- Accepted ID/capability/procedure rules.
- Correct and contextual wrong dialogue.
- Transactional one-time reveals.
- Shared accessible record selector.

### Epic P3.2 — HPA-268: Compare and route templates

- `compare`: authored columns/layers and media-card integration.
- `route`: declared nodes/edges, multiple valid paths, access/time constraints.
- Separate outbound and return paths.
- Route evidence cannot overclaim identity.

### Epic P3.3 — HPA-269: Derived-state staged map

- Node positions, mapped sublocations, phases/clusters, optional edges.
- Visibility/current/complete derived from investigation state.
- Map selection changes the existing current sublocation.
- No duplicated map lock/progress state.

### Epic P3.4 — HPA-270: Frame-strip and dual timecode

- Ordered still frames and authored overlays.
- Absolute time plus optional `S+` axis.
- Provenance/source groups.
- Compare-card source integration.
- `S+00m45s` regression protection.

### Epic P3.5 — HPA-271: Chapter 2 five-board integration

**Boards**

1. Sightline classify.
2. Image-source compare.
3. Control-room reaction order.
4. Outbound/return route.
5. Person/capability resolution.

**Facts remain separate**

- `crowd_watched_the_wall_not_the_box`
- `program_composite_is_not_direct_observation`
- `hasumi_was_the_first_human_status_source`
- `control_room_followed_a_misclassified_sponsor_incident`
- `maintenance_route_reached_the_vacant_floor`
- `return_route_did_not_use_the_expired_pass`
- `saneda_lacked_required_access`
- `hasumi_had_sponsor_access`
- `hasumi_controlled_the_first_response`
- `hasumi_had_urgent_financial_motive`

**Acceptance**

- Golden path ≤8 mandatory locations.
- At least one required sightline fact has alternate investigation routes.
- Wall-derived clips count as one source.
- QA/movement proof does not become identity proof.
- Outbound and return route both required.
- Online leads are reacquired before hearing use.
- No chapter-specific evaluator code.

---

## 10. P4 — Later-Chapter Platform

### HPA-272 — Chain template and later-chapter fixtures

- Directed cause/intervention/omission/consequence edges.
- Multiple contributors and accepted edge sets.
- Chapter 3 and 7 fixtures; Chapter 6 compare fixture.

### HPA-273 — Authoring skills and editor preview

- Analysis authoring skill.
- Investigation/interrogation story-state guidance.
- Read-only analysis/map/provenance preview.
- Shared editor/runtime layout types.

### HPA-274 — Archive expansion and migration hardening

- People, locations, authored chronology, cross-chapter anomalies, corrected official story.
- Released-schema migration fixtures.
- Definition-hash/content-revision policy documentation.
- Incompatible files remain preserved.

## 11. Required focused design sequence

Before implementation begins, write/approve focused specs in this order:

1. Global story catalog, state, provenance, support lineage, and monotonic unlock/reveal.
2. Save snapshot, stable dialogue origins, durable acquisition events, definition hashes, compatibility, and migrations.
3. Analysis Markdown/compiler/fixed-point reachability.
4. Rust analysis runtime/transactions/public view.
5. Workbench interaction/accessibility.
6. Chapter 1 Beat 8.5 and hearing handoff.
7. Investigation record interaction.
8. Chapter 2 map/media/compare/route/control-room expansion.

## 12. Program risk controls

| Risk | Control |
|---|---|
| Duplicate program contracts | Close PR #24 and supersede HPA-239 tree |
| `game/mod.rs` growth | Focused modules; orchestration only |
| Save drift after story edits | Definition hashes + explicit migrations |
| Lost acquisition popup after resume | Rust-owned durable acquisition events |
| Re-locking/unreachable content | Positive monotonic unlocks + fixed-point compiler audit |
| Provenance metadata soup | Orthogonal shared type + unspecified defaults |
| Fact laundering source independence | Supporting lineage + MVP threshold source restriction |
| Analysis grants institutional authority | Request readiness in analysis; grant in authority event |
| Map/runtime progress drift | Derive map state from sublocation state |
| Chapter 2 feature creep | P2 gate + five named boards + ≤8 mandatory locations |
| Frontend answer-key leakage | Public-view/source tests |
| Accessibility deferred | Keyboard/focus/motion acceptance in each feature ticket |

## 13. Program acceptance

The program is complete when:

- PR #23/HPA-254 are the only active program track,
- save/resume is exact for dialogue, acquisitions, investigation, interrogation, and analysis,
- catalog definitions and mutable state are separated,
- provenance/source lineage support fair source-independence checks,
- progression is monotonic and compiler-reachable,
- Chapter 1 analysis prepares a request and the hearing grants access,
- Chapter 1 packaged acceptance passes,
- Chapter 2 proves sightline, image source, control-room reaction, routes, and person capability using shared systems,
- investigation can use records on authored targets,
- later chapters can use compare/route/chain without a bespoke runtime mode.