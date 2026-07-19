# Detective Gameplay Systems High-Level Implementation Plan

> **For agentic workers:** This is the umbrella delivery plan, not a single executable coding plan. Before implementing any epic below, write and approve a focused design and a task-by-task implementation plan using `superpowers:writing-plans`; execute that plan with `superpowers:subagent-driven-development` or `superpowers:executing-plans`.

**Goal:** Add persistence and a reusable detective reasoning layer so players can organize evidence into explicit facts, use those facts in hearings, and support the Chapter 1 and Chapter 2 gameplay plans without building one-off minigames.

**Architecture:** Preserve the compiler-driven Markdown pipeline and Rust-authoritative `GameEngine`. Add durable story state, evidence provenance, and a fourth `analysis` scene type; expose typed public views to Svelte, which renders accessible reusable workbenches. Deliver the platform through a Chapter 1 vertical slice before adding Chapter 2 map, media, compare, and route capabilities.

**Tech Stack:** Rust, Tauri 2, SvelteKit static SPA, Svelte 5 runes, TypeScript 5.6, Bun 1.3.1, Turborepo, Vitest, Testing Library for Svelte, WebdriverIO/Tauri e2e, compiler-authored Markdown/YAML/JSON resources.

## Global Constraints

- Keep the SvelteKit application in static SPA mode; do not add SSR, SvelteKit endpoints, or a Node server.
- Rust owns durable game state, correctness, analysis solutions, save snapshots, and transactional mutations.
- The frontend receives typed views and sends semantic IDs; it never contains answer keys.
- Authored Markdown remains the source of truth; generated resources under `apps/game/src-tauri/resources/` are never hand-edited or committed.
- Existing `linear`, `investigation`, and `interrogation` content must continue to compile and play without migration.
- New evidence provenance defaults must remain neutral and invisible for legacy evidence until authors opt in.
- One canonical story truth remains fixed; flexible investigation order must not create alternate culprit outcomes.
- Do not add a health bar, trial lives, real-time countdowns, or irreversible failure states.
- Every drag-and-drop interaction requires a keyboard and assistive-technology alternative.
- Every implementation epic must include focused tests and the smallest broader verification set that proves cross-layer compatibility.
- Chapter 1 is the acceptance gate for the MVP; Chapter 2 expansion does not begin until the Chapter 1 vertical slice passes compiler, Rust, frontend, and Tauri e2e verification.

## Reference Design

The shared contract is defined in:

- `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`

Narrative acceptance inputs are:

- `docs/stories_plan/tokyo_rain_witness_final_story_bible_v64.md`
- the Chapter 1 final writing plan,
- the Chapter 2 V0.7 plan, and
- the V6.5 canon-sync patch.

## Program File-Responsibility Map

This is the expected ownership map. Focused specs may split files further, but they must not move ownership to a different layer without updating the umbrella design.

### Shared and compiler contracts

- `packages/scene-types/src/index.ts` — byte-identical scene index, analysis layout, map layout, and other runtime/editor shared values.
- `packages/scripts/compile-scenes/types.ts` — compiler AST and emitted JSON types for story state, provenance, analysis scenes, feedback, hints, and template-specific definitions.
- `packages/scripts/compile-scenes/parser-chapter.ts` — accept `analysis` in chapter manifests.
- `packages/scripts/compile-scenes/parser-analysis.ts` — new Markdown parser for `analysis_scene_<K>.md`.
- `packages/scripts/compile-scenes/validator.ts` and focused validation modules — IDs, references, cycles, template solutions, thresholds, routes, media time maps, and reachability.
- `packages/scripts/compile-scenes/emitter.ts` — emit the Rust wire contract.
- `packages/scripts/__fixtures__/` and compiler tests — valid and invalid analysis/story-state fixtures.

### Rust engine and persistence

- `apps/game/src-tauri/src/game/schema.rs` — serde types for story state, provenance, analysis scenes, templates, feedback, hints, maps, and media metadata.
- `apps/game/src-tauri/src/game/state.rs` — durable inventory/story records and chapter/scene state.
- `apps/game/src-tauri/src/game/scenes/analysis.rs` — analysis scene runtime and template-specific draft/evaluation logic.
- `apps/game/src-tauri/src/game/unlock.rs` — extended predicates and threshold evaluation.
- `apps/game/src-tauri/src/game/reveals.rs` — facts, questions, objectives, authorizations, and analysis reveals.
- `apps/game/src-tauri/src/game/save.rs` — save envelope, migrations, atomic file operations, validation, and load transactions.
- `apps/game/src-tauri/src/game/view.rs` — public analysis, case-file, map, media, save-summary, and story-state views.
- `apps/game/src-tauri/src/game/mod.rs` — orchestration only; new analysis/save logic should live in focused modules rather than expanding the existing large file.
- `apps/game/src-tauri/src/lib.rs` — register typed Tauri commands.
- `apps/game/src-tauri/tests/` — cross-scene, save/load, and full-playthrough coverage.

### Frontend state and components

- `apps/game/src/lib/state/types.ts` — mirror public Rust views.
- `apps/game/src/lib/state/game-client.svelte.ts` — typed command wrappers and successful-state commit boundary.
- `apps/game/src/lib/state/save-client.svelte.ts` — save-slot metadata, save/load commands, and Continue orchestration.
- `apps/game/src/lib/components/AnalysisWorkbench.svelte` — board host and common controls.
- `apps/game/src/lib/components/analysis/` — focused template components and keyboard helpers.
- `apps/game/src/lib/components/CaseFilePanel.svelte` — objective, evidence, statements, facts, and questions.
- `apps/game/src/lib/components/SaveLoadPanel.svelte` — manual slots and overwrite confirmation.
- `apps/game/src/lib/components/InvestigationMap.svelte` — staged Chapter 2 map/HUD.
- `apps/game/src/lib/components/MediaEvidenceViewer.svelte` — static frame strip and dual-time axes.
- `apps/game/src/lib/components/InvestigationSceneSurface.svelte` — authored item-use entry points without embedding correctness.
- `apps/game/src/lib/components/InterrogationView.svelte` and `DialogueBox.svelte` — consume facts/authorizations only where focused specs require it.
- `apps/game/src/routes/+page.svelte` — route the new modes and mount case-file/save surfaces without becoming the rule owner.
- `apps/game/e2e-tauri/` — production-bundle acceptance flows.

### Authoring and editor

- `.claude/skills/writing-analysis-scene/SKILL.md` — new authored format and narrative constraints.
- Existing investigation/interrogation writer skills — reference facts, provenance, authorizations, and investigation item interactions.
- `apps/layout-editor` — read-only analysis/map preview first; interactive board authoring is a later milestone.

## Milestone Sequence

| Milestone | Outcome | Entry gate | Exit gate |
|---|---|---|---|
| P0 — Persistence and Story State | Long sessions are resumable; facts, questions, objectives, authorizations, and provenance exist as durable typed data | Umbrella design approved | Save/load round trip and existing Chapter 1 regression suite pass |
| P1 — Analysis Scene MVP | Authored `analysis` scenes compile and run with `classify`, `order`, and `threshold` | P0 public contracts stable | Template fixtures, Rust tests, keyboard UI tests, and a fixture e2e pass |
| P2 — Chapter 1 Vertical Slice | Beat 8.5 is playable and its facts/authorization drive the existing final hearing | P1 complete | Full Chapter 1 playthrough, save/resume, and Tauri e2e pass |
| P3 — Chapter 2 Expansion | Staged map, source comparison, dual timecode, routes, and investigation item use support the V0.7 plan | P2 accepted | Chapter 2 golden-path prototype and route/source acceptance tests pass |
| P4 — Later-Chapter Platform | Chain reasoning, richer archive, editor support, and migration hardening are ready for Chapters 3–8 | P3 contracts stable | At least one later-chapter fixture uses each new capability without bespoke runtime code |

---

## P0 — Persistence and Story State

### Epic P0.1: Save/load, autosave, and Continue

**Linear tracking:** expand the existing `HPA-129 Save Load system` ticket rather than creating a duplicate.

**Deliverables**

- One rolling autosave, one previous autosave backup, and three manual slots.
- Versioned `SaveEnvelope` and stable-ID `GameSnapshot`.
- Atomic write and transactional load.
- Continue loads the newest valid save.
- Save-slot metadata includes chapter, scene, active objective, save type, and update time.
- Save during dialogue, investigation, interrogation, and analysis.
- Clear incompatible/corrupt-save diagnostics without partial engine mutation.

**Primary code areas**

- Create `apps/game/src-tauri/src/game/save.rs`.
- Modify `apps/game/src-tauri/src/game/mod.rs`, `state.rs`, `view.rs`, and `lib.rs`.
- Create `apps/game/src/lib/state/save-client.svelte.ts`.
- Create `apps/game/src/lib/components/SaveLoadPanel.svelte`.
- Modify `MainMenu.svelte`, `GameShell.svelte`, and `+page.svelte`.

**Verification gate**

- Rust round-trip tests for every current scene runtime.
- Atomic-backup and incompatible-content tests.
- Frontend save-slot and Continue tests.
- Tauri e2e: save, return to title, Continue, and manual overwrite.

### Epic P0.2: Durable facts, questions, objectives, and authorizations

**Deliverables**

- Rust-owned story-state collections with stable IDs.
- Public views for facts, questions, objectives, and authorizations.
- Definitions loaded from compiled content.
- Empty defaults for existing chapters.
- Snapshot support and cross-scene persistence.

**Primary code areas**

- Modify compiler types/emitter and Rust `schema.rs`, `state.rs`, and `view.rs`.
- Modify frontend `state/types.ts`.

**Verification gate**

- Duplicate-ID and unresolved-definition compiler failures.
- Rust reveal/persistence tests.
- Existing Chapter 1 resources compile unchanged.

### Epic P0.3: Evidence provenance, source groups, and proof capabilities

**Deliverables**

- Optional authored provenance metadata on evidence and statements.
- Neutral legacy defaults.
- Source-group independence and proof-capability values available to Rust evaluators and the case file.
- Visible badges only when metadata is meaningful.

**Primary code areas**

- Modify `parser-investigation.ts`, `parser-interrogation.ts`, compiler types/emitter/validator, Rust schema/state/view, and frontend record types.

**Verification gate**

- Parser and serde tests for every enum.
- Legacy records remain visually unchanged.
- A fixture proves multiple records can share one source group.

### Epic P0.4: Story-state unlock and reveal extensions

**Deliverables**

- Predicates for asserted facts, resolved questions, completed objectives, completed analysis boards, and granted authorizations.
- `not` and `at_least` combinators.
- Reveal targets for story-state mutations.
- Reachability and cycle diagnostics.

**Primary code areas**

- Modify compiler unlock parsing/validation, Rust `unlock.rs` and `reveals.rs`, and shared types.

**Verification gate**

- Unit tests for every predicate/combinator.
- Compiler rejects cycles and impossible authorizations.
- Existing evidence/topic/phase unlock fixtures still pass.

### Epic P0.5: Case file, active objective, and Continue recap

**Deliverables**

- Case-file sections for Objective, Evidence, Statements, Facts, and Questions.
- Provenance/procedure/proof-limit detail view.
- Active objective in the gameplay HUD where appropriate.
- Save/Continue recap from authored summaries and active objective.

**Primary code areas**

- Replace or wrap `InventoryPanel.svelte` with `CaseFilePanel.svelte` while preserving current re-examination behavior.
- Modify `GameShell.svelte`, `MainMenu.svelte`, and related tests.

**Verification gate**

- No spoiler labels for cross-chapter questions.
- Keyboard/focus/Escape tests.
- Evidence re-examination remains available in valid modes.

---

## P1 — Analysis Scene MVP

### Epic P1.1: Analysis-scene Markdown, compiler schema, and validation

**Deliverables**

- `analysis` chapter-manifest entry.
- `analysis_scene_<K>.md` parser.
- Tagged board union and card sources.
- Fact/question/objective/authorization definitions and reveal references.
- Template-specific diagnostics with file and line numbers.

**Primary code areas**

- Create `packages/scripts/compile-scenes/parser-analysis.ts` and focused tests/fixtures.
- Modify shared/compiler types, chapter parser, validator, emitter, and scene index.

**Verification gate**

- Valid fixtures for all MVP templates.
- Invalid fixtures for duplicate IDs, unresolved sources, impossible thresholds, missing cards, and cycles.
- Emitted JSON snapshot matches the Rust serde contract.

### Epic P1.2: Rust analysis runtime, typed drafts, evaluation, and public views

**Deliverables**

- `AnalysisSceneState` with board progress, typed drafts, failure count, hints, and resolutions.
- Commands to update a draft, submit a board, request a hint, and continue after result dialogue.
- Generation-token protection for stale UI actions.
- Transactional reveals on correct completion.

**Primary code areas**

- Create `apps/game/src-tauri/src/game/scenes/analysis.rs`.
- Modify `schema.rs`, `state.rs`, `view.rs`, `mod.rs`, and `lib.rs`.

**Verification gate**

- Rust tests for draft mutation, stale generation, wrong submission, correct submission, reveals, and save restoration.

### Epic P1.3: Accessible analysis workbench UI

**Deliverables**

- Shared board host, submit/back/hint controls, feedback surface, progress, and source/procedure badges.
- Pointer and keyboard parity.
- Focus restoration, Escape layering, live-region announcements, reduced motion, and 1280x720 support.
- Typed command wrappers and new page mode routing.

**Primary code areas**

- Create `AnalysisWorkbench.svelte` and `components/analysis/` helpers.
- Modify frontend state types, game client, and `+page.svelte`.

**Verification gate**

- Component tests for keyboard-only completion and modal layering.
- Source tests pin that correctness remains in Rust.

### Epic P1.4: `classify`, `order`, and `threshold` templates

**Deliverables**

- Typed schema, Rust evaluator, public view, and Svelte component for each template.
- Draft persistence through save/load.
- Threshold support for minimum count, distinct source groups, capabilities, procedural status, and eligible sets.

**Primary code areas**

- Compiler template types/validators.
- Rust template evaluator modules under `scenes/analysis/` if file size warrants.
- Frontend template components under `components/analysis/`.

**Verification gate**

- One valid and several invalid compiler fixtures per template.
- Rust evaluator property/edge-case tests.
- Keyboard/pointer parity tests.

### Epic P1.5: Contextual feedback and progressive hints

**Deliverables**

- Feedback precedence for exact combinations, procedure status, duplicate source group, missing capability, incomplete structure, and default.
- Four authored hint levels.
- Failure count and requested hint level saved with the board.
- No answer reveal before the authored hint level allows it.

**Primary code areas**

- Compiler feedback/hint parser and validation.
- Rust feedback evaluator and views.
- Workbench feedback/hint components.

**Verification gate**

- Deterministic precedence tests.
- Accessibility tests for feedback announcements and focus return.

### Epic P1.6: Named procedure-authorization gates

**Deliverables**

- Authorization definitions, grants, case-file display, unlock predicates, and hearing integration.
- No numeric credibility or life meter.
- Wrong requests remain retryable.

**Primary code areas**

- Story-state compiler/Rust modules, analysis reveals, case file, and focused interrogation unlock paths.

**Verification gate**

- Threshold board grants an authorization exactly once.
- Locked content remains locked without the grant.
- Save/load preserves the grant.

---

## P2 — Chapter 1 Vertical Slice

### Epic P2.1: Author Chapter 1 Beat 8.5 analysis scene

**Deliverables**

- Add `analysis_scene_8_5.md` or replace the current Beat 8.5 transition with an analysis scene while preserving manifest order and existing canon.
- Classify evidence into the three Chapter 1 packages.
- Order `Event-1841` through `Event-1844`.
- Select two independent contradictions for narrow extraction.
- Assert three facts and grant `narrow_lock_export`.
- Preserve the current final hearing as the dramatic proof stage.

**Primary content areas**

- `docs/stories_plan/chapter_1/chapter.md`.
- Chapter 1 Beat 8.5 authored files and affected final-hearing unlocks.
- Chapter 1 evidence provenance metadata for board-referenced records.

**Verification gate**

- `bun run scenes:compile` succeeds without warnings for required board metadata.
- Existing scene assets/audio remain valid.
- A player cannot reach the narrow-extraction phase with two same-source contradictions.

### Epic P2.2: Chapter 1 analysis/save acceptance coverage

**Deliverables**

- Rust full-playthrough updates.
- Tauri e2e path through all three boards and the final hearing.
- Save during an incomplete board; close, Continue, and resume the draft.
- Wrong feedback, hint, authorization, acquisition, dialogue history, audio, and Escape integration coverage.

**Primary code areas**

- `apps/game/src-tauri/tests/full_playthrough.rs` and focused Rust tests.
- `apps/game/e2e-tauri/` production anchors/helpers/specs.
- Frontend page/component integration tests.

**Verification gate**

- Root `bun run test`, `bun run check`, `bun run check:scripts`, Rust test/lint, scene compile, and Tauri e2e pass.

P2 is the go/no-go gate for Chapter 2 expansion.

---

## P3 — Chapter 2 Expansion

### Epic P3.1: Evidence and statement use during investigation

**Deliverables**

- Authored item interactions for characters, topics, hotspots, and sublocation interaction points.
- Correct, item-specific wrong, capability-mismatch, procedure-mismatch, and default dialogue.
- Reveal processing through the existing inventory/story-state system.
- Inventory selector reusable by analysis/interrogation/investigation.

**Verification gate**

- Only authored targets accept item use.
- Wrong use does not mutate story state.
- Save/load preserves resulting reveals.

### Epic P3.2: `compare` and `route` analysis templates

**Deliverables**

- Multi-column alignment for source/layer comparison.
- Authored map-node paths with multiple valid paths where declared.
- Separate outbound and return routes.
- Structured feedback for source mismatch, missing node, invalid edge, and route that proves movement but not identity.

**Verification gate**

- Chapter 2 fixture aligns wall/composite/direct observation correctly.
- Route fixture rejects use of the expired pass on the return path.

### Epic P3.3: Staged investigation-map metadata and HUD navigation

**Deliverables**

- Map node positions, edges, stage/cluster membership, sublocation mapping, and completion state.
- Phase A/B/C reveal progression using existing unlock rules.
- Current objective and case-file entry points in the Explore HUD.
- No second navigation state separate from investigation sublocations.

**Verification gate**

- Locked nodes are not keyboard or pointer reachable.
- Map and sublocation state cannot drift.
- Phase transitions survive save/load.

### Epic P3.4: Static frame-strip media evidence and dual timecode viewer

**Deliverables**

- Ordered still frames with absolute time, optional `S+` relative time, source labels, provenance, and optional overlays.
- Evidence detail and `compare` card integration.
- Asset fallback, keyboard frame navigation, and reduced motion.

**Verification gate**

- `S+00m45s` aligns with `00:00:45 a.m.` in compiler and UI tests.
- Invalid or non-monotonic time maps fail compilation.
- Missing optional frame art does not block logic.

### Epic P3.5: Author Chapter 2 gameplay boards and map progression

**Deliverables**

- Sightline, image-source, route, and person boards.
- Phase A/B/C map metadata with 7–8 golden-path locations.
- Main facts and procedure gates defined in the Chapter 2 plan.
- Optional side investigations strengthen dialogue or evidence but are never the only required source.
- Investigation-time evidence interactions for selected witness and access-route beats.

**Verification gate**

- The first sightline inversion occurs within the planned Phase A pacing.
- Multiple videos derived from the wall count as one source group.
- The player proves both outbound and return routes.
- Saneda can be identified as malicious but cannot satisfy access requirements.
- Hasumi is not indictable until access, control position, motive, and route are established.

---

## P4 — Later-Chapter Platform

### Epic P4.1: `chain` template and later-chapter readiness

**Deliverables**

- Directed authored cause/omission/consequence chains.
- Multiple contributors without forcing one culprit node.
- Chapter 3 and Chapter 7 valid fixtures.
- Chapter 6 raw/sync/summary comparison fixture using `compare`.

**Verification gate**

- The evaluator distinguishes causation from mere chronology.
- A valid multi-contributor chain does not require a false single-culprit answer.

### Epic P4.2: Layout-editor and authoring-skill support

**Deliverables**

- Read-only analysis/map preview in the layout editor.
- Evidence-source/provenance inspection.
- Authoring skill for analysis scenes.
- Focused authoring guidance for facts, questions, objectives, authorizations, feedback, and hints.
- Interactive editor authoring only after the Markdown/runtime contract has been stable through Chapter 2.

**Verification gate**

- Editor and runtime read the same shared map/layout wire types.
- Writer fixtures compile without hand-editing generated JSON.

### Epic P4.3: Case archive expansion and migration hardening

**Deliverables**

- People, locations, chronology, cross-chapter anomalies, and resolved-case history if Chapter 1/2 usability testing supports them.
- Save-schema migrations for every released version.
- Content-revision compatibility diagnostics suitable for packaged releases.

**Verification gate**

- Historical save fixtures migrate forward.
- Incompatible saves remain recoverable as files and are never silently overwritten.

---

## Dependency Graph

```text
P0.2 Story state ─┬─> P0.4 Unlock/reveal ─┬─> P1.1 Compiler contract
                  │                        └─> P1.6 Procedure gates
P0.3 Provenance ──┴──────────────────────────> P1.4 Threshold evaluation
P0.1 Save/load ──────────────────────────────> P2 Chapter 1 acceptance
P0.5 Case file <── P0.2 + P0.3 + P0.1

P1.1 Compiler ─┬─> P1.2 Rust runtime ─> P1.3 Workbench
               └─> P1.4 Templates ─────> P1.5 Feedback/hints
P1.2 + P1.3 + P1.4 + P1.6 ─────────────> P2.1 Chapter 1 content
P2.1 ───────────────────────────────────> P2.2 Acceptance gate

P2 accepted ─┬─> P3.1 Investigation item use
             ├─> P3.2 Compare/route
             ├─> P3.3 Map
             └─> P3.4 Media/timecode
P3.1 + P3.2 + P3.3 + P3.4 ─────────────> P3.5 Chapter 2 content
P3 accepted ─────────────────────────────> P4 later-chapter work
```

## Verification Matrix

| Change type | Minimum focused verification | Broader gate before completion |
|---|---|---|
| Compiler schema/parser | Focused parser/validator/emitter tests and fixtures | `bun run scenes:compile`, `bun run test:scripts`, `bun run check:scripts` |
| Rust engine/state/save | Focused Cargo tests | full `cargo test`, `bun run rust:lint` |
| Frontend state/component | Focused Vitest/Testing Library tests | `bun run check`, app test task, `bun run lint` where applicable |
| Cross-stack scene feature | compiler + Rust + frontend focused tests | root `bun run test`, scene compile, checks, Rust tests/lint |
| Production flow | production-anchor update and focused WDIO spec | `bun run test:e2e` |
| Authored Chapter 1/2 content | compile and full-playthrough fixture | Tauri e2e golden path and manual desktop smoke test |

## Program Risks and Controls

### Scope explosion

**Risk:** every chapter requests a unique interaction.  
**Control:** new gameplay must first be expressible as a typed template or authored interaction. A bespoke runtime mode requires a separate design proving the existing grammar cannot represent it.

### `GameEngine` file growth

**Risk:** `mod.rs` becomes harder to reason about.  
**Control:** save and analysis logic live in focused modules. The umbrella plan explicitly avoids placing template evaluators or persistence serialization directly in `mod.rs`.

### Authoring complexity

**Risk:** boards become difficult to write and debug.  
**Control:** tagged templates, precise compiler diagnostics, valid/invalid fixtures, and a dedicated authoring skill. The layout editor remains read-only until the contract is stable.

### Frontend/Rust contract drift

**Risk:** public views and Svelte types silently diverge.  
**Control:** mirror types intentionally, add source/serde tests, keep byte-identical layout values in `@lyra/scene-types`, and verify emitted snapshots against Rust fixtures.

### Save incompatibility during active story editing

**Risk:** scene IDs change while content is still being authored.  
**Control:** stable semantic IDs, content revision checks, explicit migrations, transactional loading, and no silent reset.

### Puzzle frustration

**Risk:** players brute-force cards or cannot tell why a plausible answer failed.  
**Control:** source groups, proof capabilities, procedure status, contextual feedback, preserved drafts, and deliberate progressive hints.

### Accessibility regressions

**Risk:** visual boards become pointer-only.  
**Control:** keyboard interaction is part of each template's acceptance gate, not a later polish ticket.

## Linear Tracking Structure

Use the existing Linear project **Lyra** and team **hapadona**.

Create these milestones:

- `P0 — Persistence and Story State`
- `P1 — Analysis Scene MVP`
- `P2 — Chapter 1 Vertical Slice`
- `P3 — Chapter 2 Expansion`
- `P4 — Later-Chapter Platform`

Create one parent program issue and use the epic titles from this plan as child issues. Reuse and expand existing `HPA-129` for P0.1. Relate existing `HPA-131 Investigation scene enhancement` to P3.1 rather than duplicating its already-tracked acquisition/re-examination concerns.

Each Linear feature ticket must include:

- the relevant design and plan links,
- scope and explicit non-goals,
- affected ownership layers,
- measurable acceptance criteria,
- verification commands/categories,
- milestone,
- dependency relations, and
- priority.

No due dates or assignees are invented in this plan.

## Program Completion Definition

The program is complete when:

- players can safely save and resume across all durable modes,
- Chapter 1 includes a saved, accessible analysis scene that produces facts and a procedure authorization,
- the existing final hearing consumes those results without duplicating the analysis explanation,
- Chapter 2 can stage its map, compare independent observation sources, align `S+` and absolute time, and prove separate outbound/return routes,
- evidence can be used on authored investigation targets,
- later chapters can use `compare`, `route`, and `chain` without bespoke engines,
- all authored content is compiler validated,
- Rust remains authoritative,
- frontend interactions have keyboard parity, and
- full tests, checks, lint, and Tauri e2e gates pass for the affected milestones.
