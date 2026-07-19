# Detective Gameplay Foundations High-Level Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add persistence, explicit reasoning state, evidence provenance, compiler-driven analysis scenes, investigation evidence use, and production Chapter 1/2 vertical slices so Lyra supports the complete loop: investigate → analyze → assert a fact → earn access → prove the case.

**Architecture:** Preserve Lyra's existing Markdown → compiler → generated JSON → Rust `GameEngine` → Svelte presentation pipeline. Introduce small focused domain modules for persistence, provenance, facts/access, and analysis; keep validation authoritative in Rust and authoring errors in the compiler. Ship Chapter 1 as the first production proof before adding Chapter 2's map, media comparison, route, and causal-chain features.

**Tech Stack:** Bun 1.3.1 workspaces, Turborepo, TypeScript 5.6, Svelte 5/SvelteKit SPA, Tauri 2, Rust/Serde, Vitest, WebdriverIO Tauri E2E, Markdown scene compiler.

**Spec:** `docs/superpowers/specs/2026-07-19-detective-gameplay-foundations-design.md`

**Linear parent:** [HPA-239](https://linear.app/cwchanap/issue/HPA-239/detective-gameplay-foundations-reasoning-provenance-persistence-and)

## Global Constraints

- Package manager is **bun**, pinned to `bun@1.3.1`.
- The game remains a SvelteKit static SPA inside Tauri; do not add SSR, server routes, or Node runtime dependencies.
- Rust owns all authoritative gameplay state and validation.
- Markdown is parsed only at build time; never parse authored scenes in the frontend or Rust runtime.
- Do not hand-edit generated JSON under `apps/game/src-tauri/resources/scenes/` or `apps/game/src-tauri/resources/assets/`.
- Existing `linear`, `investigation`, and `interrogation` content must compile and play unchanged when it does not use the new features.
- New progression rules are monotonic. Do not add generic negation or any mechanic that re-locks previously visible content.
- Analysis correctness is revealed only on whole-board submission, not after each card movement.
- Drag-and-drop may be visual sugar but cannot be the only input method.
- Facts are conclusions and must not be represented as physical evidence cards.
- Optional investigation branches may strengthen corroboration, dialogue, or hints but cannot be the only source of a mandatory fact.
- Each ticket lands as an independently reviewable PR with focused tests and no unrelated refactor.

---

## Target File Structure

### Shared scene contracts

**Modified:**

- `packages/scene-types/src/index.ts` — shared map/reveal and analysis-adjacent wire contracts that are consumed by compiler/editor surfaces.
- `packages/scripts/compile-scenes/types.ts` — compiler AST/JSON types for provenance, facts, questions, access grants, analysis scenes, media sets, and unlock extensions.

### Compiler

**Created:**

- `packages/scripts/compile-scenes/analysis-types.ts` — compiler-local analysis AST helpers and template declarations.
- `packages/scripts/compile-scenes/parser-analysis.ts` — `analysis_scene_<K>.md` parser.
- `packages/scripts/compile-scenes/validator-analysis.ts` — board/reference/reachability validation.
- `packages/scripts/compile-scenes/emitter-analysis.ts` — analysis JSON emission.

**Modified:**

- `packages/scripts/compile-scenes/parser-chapter.ts` — recognize `analysis_scene_*.md`.
- `packages/scripts/compile-scenes/parser-investigation.ts` — provenance and item-use metadata.
- `packages/scripts/compile-scenes/parser-interrogation.ts` — context-aware wrong-presentation metadata.
- `packages/scripts/compile-scenes/validator.ts` — game-global IDs and cross-scene references.
- `packages/scripts/compile-scenes/emitter.ts` — dispatch new scene/domain types.
- `packages/scripts/compile-scenes/config-check.ts` — any new asset/media references.
- `packages/scripts/__fixtures__/` and compiler test files — valid/invalid/golden fixtures.

### Rust engine

**Created:**

```text
apps/game/src-tauri/src/game/
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
  persistence/
    mod.rs
    schema.rs
    storage.rs
  provenance.rs
  facts.rs
  access.rs
```

**Modified:**

- `apps/game/src-tauri/src/game/mod.rs` — delegate orchestration and register the new scene runtime without absorbing template logic.
- `apps/game/src-tauri/src/game/schema.rs` — emitted JSON schema.
- `apps/game/src-tauri/src/game/state.rs` — game-global inventory/fact/question/access collections.
- `apps/game/src-tauri/src/game/scenes/mod.rs` — `Analysis` scene dispatch.
- `apps/game/src-tauri/src/game/unlock.rs` — new monotonic predicates and `at_least`.
- `apps/game/src-tauri/src/game/reveals.rs` — fact/question/access/analysis reveal targets.
- `apps/game/src-tauri/src/game/view.rs` — analysis/archive/map/media view models.
- `apps/game/src-tauri/src/lib.rs` — new Tauri commands.
- `apps/game/src-tauri/tests/full_playthrough.rs` — Chapter 1 production loop and save/resume coverage.

### Svelte frontend

**Created:**

```text
apps/game/src/lib/components/
  AnalysisView.svelte
  AnalysisCard.svelte
  AnalysisFeedbackPanel.svelte
  ClassifyBoard.svelte
  OrderBoard.svelte
  ThresholdBoard.svelte
  CompareBoard.svelte
  RouteBoard.svelte
  ChainBoard.svelte
  CaseArchive.svelte
  MediaFrameStrip.svelte
  InvestigationMap.svelte
```

Focused archive section components may be split into `apps/game/src/lib/components/archive/` when `CaseArchive.svelte` would otherwise own several unrelated responsibilities.

**Modified:**

- `apps/game/src/lib/state/types.ts` — new view contracts.
- `apps/game/src/lib/state/game-client.svelte.ts` — Tauri commands and acquisition ordering.
- `apps/game/src/lib/state/mode.ts` — visibility/reexamine rules for analysis/archive states.
- `apps/game/src/routes/+page.svelte` — analysis mode dispatch, save/load menu integration, archive integration.
- `apps/game/src/lib/components/MainMenu.svelte` — Continue/Load.
- `apps/game/src/lib/components/GameShell.svelte` — Archive and save/load menu surfaces.
- `apps/game/src/lib/components/InvestigationSceneSurface.svelte` — evidence-use entry points.
- `apps/game/src/lib/components/InterrogationView.svelte` and `DialogueBox.svelte` — richer feedback without breaking inline challenge behavior.

### Layout editor and authoring

**Created/modified:**

- `.claude/skills/writing-analysis-scene/SKILL.md` — canonical analysis authoring guide.
- `.claude/skills/writing-chapter-manifest/SKILL.md` — analysis filename support.
- `apps/layout-editor/src/lib/layout-types.ts` — optional investigation map metadata.
- `apps/layout-editor/src/lib/layout-store.svelte.ts` — map state persistence.
- `apps/layout-editor/src/lib/EditorCanvas.svelte` or a focused map editor component — map preview/editing.
- `CLAUDE.md` — route analysis authoring through the new skill.

### Production story content

**Modified/created:**

- `docs/stories_plan/chapter_1/chapter.md` — insert the production analysis scene at Beat 8.5.
- `docs/stories_plan/chapter_1/analysis_scene_8_5.md` — Chapter 1 boards, facts, access grant, feedback, and hints.
- Relevant Chapter 1 investigation/interrogation files — provenance metadata and fact/access unlocks only where required.
- Chapter 2 authored scene files — phased map, media sources, five analysis boards, and final hearing integration when that chapter enters production.

---

## Dependency Map

```text
HPA-129 Save/load ─────────────────────────────┐
                                               ├─ HPA-246 Case Archive ─┐
HPA-240 Evidence provenance ─┬─ HPA-244 R1 templates ─┐               │
                             ├─ HPA-247 Item use       │               │
                             ├─ HPA-248 Feedback       │               │
                             └─ HPA-250 Media          │               │
                                                               HPA-249 Chapter 1
HPA-241 Facts/questions/access ─ HPA-242 Unlock DSL ─ HPA-243 Analysis core
                                                        └─ HPA-244 R1 templates
                                                            └─ HPA-245 Authoring skill

HPA-244 R1 templates ─ HPA-252 R2 templates ───────────┐
HPA-250 Media ─────────────────────────────────────────┤
HPA-251 Investigation map ─────────────────────────────┤
HPA-247 Investigation item use ────────────────────────┤
HPA-248 Feedback/hints ────────────────────────────────┤
HPA-246 Case Archive ──────────────────────────────────┤
HPA-129 Save/load ─────────────────────────────────────┴─ HPA-253 Chapter 2
```

The Linear blocker graph is the execution source of truth. This diagram documents the intended sequencing and parallelism.

---

## Phase 0: Persistence Foundation

### Task 1: HPA-129 — Versioned save/load, autosave, and Continue

**Linear:** [HPA-129](https://linear.app/cwchanap/issue/HPA-129/implement-versioned-saveload-autosave-and-continue)

**Files:**

- Create: `apps/game/src-tauri/src/game/persistence/{mod.rs,schema.rs,storage.rs}`
- Modify: `apps/game/src-tauri/src/game/mod.rs`
- Modify: `apps/game/src-tauri/src/lib.rs`
- Modify: `apps/game/src/lib/state/game-client.svelte.ts`
- Modify: `apps/game/src/lib/components/MainMenu.svelte`
- Modify: `apps/game/src/routes/+page.svelte`
- Test: Rust persistence tests, frontend menu tests, Tauri E2E Continue test

**Produces:**

- Versioned `SaveEnvelope` and extensible `GameSnapshot`.
- `list_saves`, `save_game`, `load_game`, `delete_save`, and `continue_game` command contracts.
- Autosave and three manual slots.
- A content fingerprint hook that later feature tickets extend rather than replace.

**Implementation boundary:**

The initial snapshot covers current engine fields. HPA-241/HPA-243 extend the snapshot for new state through versioned fields and tests. Persistence must not block on those features, but it must not hard-code a closed snapshot shape.

**Verification gate:**

```bash
cargo test --manifest-path apps/game/src-tauri/Cargo.toml persistence
bun run --cwd apps/game test
bun run check
bun run test:e2e
```

Expected: saves round-trip; failed writes/loads preserve prior state; Continue survives process restart.

---

## Phase 1: Reasoning Domain

### Task 2: HPA-240 — Evidence provenance and procedural state

**Linear:** [HPA-240](https://linear.app/cwchanap/issue/HPA-240/add-evidence-provenance-and-procedural-state-metadata)

**Files:** compiler types/parser/emitter, Rust schema/inventory/view, frontend types, dossier rendering tests.

**Produces:**

- `EvidenceLayer`, `ProceduralStatus`, `EvidenceConfidence`, `ProofScope`, `sourceGroup`, and supersession.
- Safe defaults for every existing evidence record.
- Queryable metadata for threshold and feedback systems.

**Review gate:** Reject any implementation that renames or repurposes current discovery `Evidence Source: visible|implied|hidden` without a migration path.

### Task 3: HPA-241 — Facts, questions, and access grants

**Linear:** [HPA-241](https://linear.app/cwchanap/issue/HPA-241/add-game-global-facts-questions-and-procedural-access-grants)

**Files:** compiler domain types, Rust `facts.rs`/`access.rs`/state/reveals/view, frontend types.

**Produces:**

- Game-global records and manifests.
- Idempotent assertion/grant behavior.
- Automatic question resolution.
- Reveal targets consumed by analysis and hearing content.

### Task 4: HPA-242 — Unlock DSL and reachability

**Linear:** [HPA-242](https://linear.app/cwchanap/issue/HPA-242/extend-unlock-dsl-with-facts-analyses-access-grants-and-at-least)

**Blocked by:** HPA-241

**Files:** compiler unlock parser/validator, `apps/game/src-tauri/src/game/unlock.rs`, fixtures/tests.

**Produces:**

- `fact_asserted`, `analysis_completed`, `access_granted`, and `at_least`.
- Static diagnostics for invalid counts and unreachable required content.

**Review gate:** Do not add negation. All new conditions must remain monotonic and replay-safe.

**Phase verification:**

```bash
bun run test:scripts
bun run check:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run scenes:compile
```

Expected: all existing live content compiles; new domain fixtures pass; no current playthrough regression.

---

## Phase 2: Analysis Core

### Task 5: HPA-243 — Analysis scene pipeline and runtime shell

**Linear:** [HPA-243](https://linear.app/cwchanap/issue/HPA-243/add-compiler-driven-analysis-scene-type-and-rust-runtime-core)

**Blocked by:** HPA-241, HPA-242

**Produces:**

- `analysis_scene_<K>.md` recognition and validated JSON.
- `SceneRuntime::Analysis` lifecycle, board token, snapshot state, and atomic completion reveals.
- Template-independent Svelte shell.

**Review gate:** Template validation does not live in `game/mod.rs`. Incorrect player placements return feedback; malformed commands return typed errors.

### Task 6: HPA-244 — Classify, order, and threshold templates

**Linear:** [HPA-244](https://linear.app/cwchanap/issue/HPA-244/implement-classify-order-and-threshold-analysis-templates)

**Blocked by:** HPA-240, HPA-243

**Produces:**

- First production template set.
- Keyboard and pointer interaction.
- Source-group/proof-scope/procedural threshold validation.
- Holistic submit feedback.

**Review gate:** A correct move must not light up before full submission. Threshold rules must distinguish two files from two independent sources.

### Task 7: HPA-245 — Analysis authoring skill and audit guidance

**Linear:** [HPA-245](https://linear.app/cwchanap/issue/HPA-245/add-analysis-scene-authoring-skill-examples-and-compiler-audit)

**Blocked by:** HPA-243, HPA-244

**Produces:**

- Writer-facing canonical format and examples.
- Chapter manifest and agent guidance updates.
- Reachability/source-independence audit instructions.

**Phase verification:**

```bash
bun run test:scripts
bun run check:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml analysis
bun run --cwd apps/game test
bun run check
```

Expected: minimal analysis fixture loads and all three templates are completable without a mouse.

---

## Phase 3: Player Reasoning Experience and Chapter 1

### Task 8: HPA-246 — Case Archive and current objective

**Linear:** [HPA-246](https://linear.app/cwchanap/issue/HPA-246/build-case-archive-with-objective-provenance-facts-questions-and)

**Blocked by:** HPA-129, HPA-240, HPA-241

**Produces:**

- Objective/Evidence/Statements/Facts/Questions/Access sections.
- Save summary integration.
- Provenance and supersession visualization.

### Task 9: HPA-248 — Context-aware feedback and hint ladder

**Linear:** [HPA-248](https://linear.app/cwchanap/issue/HPA-248/add-context-aware-wrong-presentation-feedback-and-progressive-analysis)

**Blocked by:** HPA-240, HPA-243

**Produces:**

- Exact item → proof scope → procedural status → default fallback resolution.
- Failed-attempt/manual authored hints.
- Incomplete/incorrect/overclaim distinction.

### Task 10: HPA-249 — Chapter 1 Beat 8.5 vertical slice

**Linear:** [HPA-249](https://linear.app/cwchanap/issue/HPA-249/author-and-integrate-the-chapter-1-beat-85-analysis-vertical-slice)

**Blocked by:** HPA-129, HPA-244, HPA-245, HPA-246, HPA-248

**Produces:**

- Three production boards.
- Three established facts.
- `narrow_door_lock_extraction` grant.
- Final hearing unlock integration.
- Full playthrough and E2E save/resume proof.

**Chapter 1 integration gate:**

```bash
bun run scenes:compile
bun run evidence-sources:audit
bun run test:scripts
bun run check:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml full_playthrough
bun run --cwd apps/game test
bun run check
bun run rust:lint
bun run test:e2e
```

Expected: new game through Chapter 1 completion passes; incorrect analysis reveals nothing; autosave resumes solved/unsolved state correctly.

---

## Phase 4: Investigation Expression

### Task 11: HPA-247 — Present/use inventory items during investigation

**Linear:** [HPA-247](https://linear.app/cwchanap/issue/HPA-247/allow-evidence-and-statements-to-be-used-on-investigation-targets)

**Blocked by:** HPA-240

**Related:** HPA-131

**Produces:**

- Authored item interactions for hotspots, characters, topics, and sublocations.
- One-shot/repeatable semantics and safe fallback.
- Item-first and target-first accessible UI flow.

This task may execute in parallel with Phase 3 after provenance lands. It is required before Chapter 2 production but not required for the Chapter 1 analysis proof.

---

## Phase 5: Chapter 2 Platform Features

### Task 12: HPA-250 — Static media frame strip

**Linear:** [HPA-250](https://linear.app/cwchanap/issue/HPA-250/add-static-media-frame-strip-viewer-with-absolute-and-relative)

**Blocked by:** HPA-240

**Produces:**

- Authored `MediaFrameSet` records.
- Absolute and sponsor-relative time labels.
- Source switching and analysis-card integration.

**Regression gate:** Add a test that proves `S+00m45s` remains an opaque relative label and is never rendered as 00:45 a.m.

### Task 13: HPA-251 — Investigation map metadata and UI

**Linear:** [HPA-251](https://linear.app/cwchanap/issue/HPA-251/add-investigation-map-metadata-and-phased-map-navigation-ui)

**Produces:**

- Optional map nodes/connections/clusters.
- Layout-editor support.
- `InvestigationMap.svelte` with `SublocationNav` fallback.

This task can run in parallel with HPA-250 and HPA-252.

### Task 14: HPA-252 — Compare, route, and causal-chain templates

**Linear:** [HPA-252](https://linear.app/cwchanap/issue/HPA-252/implement-compare-route-and-causal-chain-analysis-templates)

**Blocked by:** HPA-244

**Produces:**

- Source-layer comparison.
- Constrained path validation with time/access requirements.
- Fixed causal/responsibility chains.

**Review gate:** No template may become a general spreadsheet, graph editor, or freehand route drawer.

---

## Phase 6: Chapter 2 Production Integration

### Task 15: HPA-253 — Chapter 2 Shibuya vertical slice

**Linear:** [HPA-253](https://linear.app/cwchanap/issue/HPA-253/author-and-integrate-the-chapter-2-shibuya-analysismap-vertical-slice)

**Blocked by:** HPA-129, HPA-245, HPA-246, HPA-247, HPA-248, HPA-250, HPA-251, HPA-252

**Produces:**

- Three-cluster Shibuya map.
- Viewpoint, feed, route, capability, and control-room-chain boards.
- Required Chapter 2 facts and final hearing integration.
- Alternate investigation route for at least one mandatory fact.
- Dual absolute/`S+` time presentation.

**Chapter 2 integration gate:**

```bash
bun run scenes:compile
bun run evidence-sources:audit
bun run test:scripts
bun run check:scripts
cargo test --manifest-path apps/game/src-tauri/Cargo.toml
bun run --cwd apps/game test
bun run check
bun run rust:lint
bun run test:e2e
```

Expected: mandatory golden path uses no more than 7–8 locations; five boards save/resume; final hearing consumes facts; no Chapter 2-specific engine validation exists.

---

## Recommended PR Order

1. **HPA-129** — persistence foundation.
2. **HPA-240** — evidence provenance.
3. **HPA-241** — facts/questions/access.
4. **HPA-242** — unlock DSL/reachability.
5. **HPA-243** — analysis scene core.
6. **HPA-244** — release-1 templates.
7. **HPA-245** — authoring skill/docs.
8. **HPA-246** — Case Archive.
9. **HPA-248** — feedback/hints.
10. **HPA-249** — Chapter 1 production vertical slice.
11. **HPA-247** — investigation item use; may move earlier after HPA-240 if capacity permits.
12. **HPA-250**, **HPA-251**, **HPA-252** — parallel Chapter 2 platform work after their blockers.
13. **HPA-253** — Chapter 2 production integration.

Do not combine the domain, compiler/runtime core, three template families, and story vertical slice into one PR. A reviewer must be able to accept the reusable engine while rejecting production content, or accept one template while rejecting another.

## Cross-Cutting Test Matrix

| Concern | Compiler | Rust | Frontend | E2E |
|---|---:|---:|---:|---:|
| Legacy content compatibility | ✓ | ✓ | smoke | ✓ |
| Provenance round-trip | ✓ | ✓ | ✓ | — |
| Fact/question/access idempotency | ✓ | ✓ | ✓ | ✓ |
| Unlock reachability | ✓ | ✓ | — | playthrough |
| Analysis lifecycle | ✓ | ✓ | ✓ | ✓ |
| Template correctness | ✓ | ✓ | ✓ | Chapter slice |
| Keyboard/reduced motion | — | — | ✓ | smoke |
| Atomic save/load | — | ✓ | ✓ | ✓ |
| Optional-route convergence | ✓ | ✓ | ✓ | Chapter 2 |
| `S+` time-label correctness | ✓ | view | ✓ | Chapter 2 |

## Risk Controls

### Risk: `game/mod.rs` grows further

Control: analysis, persistence, facts, access, and provenance receive focused modules. `GameEngine` orchestrates and delegates.

### Risk: story writers cannot use the schema reliably

Control: HPA-245 lands before production vertical slices and includes compiling examples plus exact diagnostics.

### Risk: boards feel like matching quizzes

Control: holistic submission, authored structural feedback, optional cards, alternate routes, and no correctness feedback per movement.

### Risk: provenance creates jargon-heavy UI

Control: semantic IDs remain stable while player-facing labels are localized and concise. Dialogue is not required to repeat raw/sync/summary terminology.

### Risk: save format churn

Control: format/content versions, explicit incompatibility, additive snapshot evolution, and round-trip tests on each state-owning ticket.

### Risk: Chapter 2 becomes a bespoke subsystem

Control: every board uses generic templates; map metadata is optional; media is static authored data; no chapter ID appears in engine validation code.

### Risk: optional branches accidentally gate mandatory progress

Control: compiler reachability/source-independence audit plus Chapter 2 E2E paths using different evidence routes.

## Program Definition of Done

- [ ] HPA-129 and HPA-240 through HPA-253 are complete or explicitly descoped in HPA-239.
- [ ] The design spec and this plan are updated when an approved implementation changes a contract.
- [ ] Chapter 1 requires player-owned reasoning before narrow extraction and the final hearing.
- [ ] Save/Continue survives a process restart with no duplicate reveals.
- [ ] Facts, questions, and access are visible in the Case Archive and remain separate from evidence.
- [ ] At least one mandatory fact supports alternate independent investigation routes.
- [ ] Chapter 2 represents observation-source independence, dual time labels, route continuity, and a causal control-room chain through reusable content data.
- [ ] All live scenes compile without warnings introduced by the new feature set.
- [ ] Root checks, Rust tests/lint, frontend checks/tests, and Tauri E2E pass before the program is declared complete.
