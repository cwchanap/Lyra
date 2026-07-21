# Detective Gameplay Systems Design

**Date:** 2026-07-19  
**Revised:** 2026-07-21  
**Status:** Proposed for final approval  
**Scope:** Shared detective-gameplay architecture, persistence, and the Chapter 1/2 validation slices. Each major subsystem still requires a focused design and executable implementation plan before code changes begin.

## 1. Normative source and narrative precedence

This file is the **sole normative architecture and gameplay contract** for the detective-gameplay program:

```text
docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md
```

The companion implementation plan defines sequencing, code ownership, tickets, and verification gates. It may summarize a requirement for execution context, but it must not create a competing behavioral contract.

Where narrative documents disagree, use this order:

1. Chapter 1 Final Writing Plan V3.7.
2. Chapter 2 Plan V0.7 Timecode / Control-Room Reaction Lock.
3. Story Bible V6.5 Canon Sync Patch.
4. Story Bible V6.4.
5. Older handover notes and review drafts.

This prevents implementation from restoring superseded Chapter 1 timing, the old Chapter 2 one-way-glass or forged-work-order explanation, premature `ZW_A16.lock` decoding, or obsolete chapter-duration targets.

## 2. Summary

Lyra currently supports this core loop:

1. read linear dialogue,
2. investigate hotspots and interview characters,
3. collect evidence and statements,
4. challenge testimony,
5. present one record against one contradiction.

The story requires a missing middle step: players must organize several individually truthful fragments into an explicit inference before using that inference in a hearing.

The central addition is a fourth compiler-driven scene type, `analysis`, backed by Rust-owned deterministic state and reusable board templates. It does not replace investigation or interrogation.

The program also adds:

- exact save/load, autosave, and Continue,
- first-class facts, questions, objectives, and named authorizations,
- shared case-record provenance and support lineage,
- a case file separating records from conclusions,
- contextual feedback and authored hints,
- investigation-time evidence and statement use,
- staged investigation maps,
- static media frame strips with dual time axes.

The result is one reusable detective grammar instead of one custom minigame per chapter.

## 3. Narrative drivers

The recurring story rule is:

> Evidence fragments may be individually true while the story assembled from them is false.

The system must let players:

- group records by the claim they can support,
- distinguish independent sources from repeated views of one source,
- place events in a defensible order,
- compare raw, synchronized, summarized, composite, physical, testimonial, and subjective representations,
- build routes through authored locations and access gates,
- connect multiple contributors in a responsibility chain,
- prepare a justified procedural request,
- receive authorization only from the institution represented by the story,
- carry unresolved questions across chapters without labeling spoilers.

## 4. Goals

- Make the player perform the important inference.
- Preserve one canonical truth while allowing flexible investigation order.
- Support the eight-chapter evidence themes with a small typed template set.
- Keep Rust authoritative for accepted solutions, durable state, transactions, and saves.
- Keep story authoring in Markdown and semantic IDs.
- Preserve existing `linear`, `investigation`, and `interrogation` content unless it opts into a new feature.
- Explain source and proof limitations without turning dialogue into a terminology lesson.
- Validate the shared system through Chapter 1, then Chapter 2.
- Support keyboard, assistive technology, reduced motion, and non-pointer interactions.
- Make three-to-four-hour chapters safe to leave and resume.

## 5. Non-goals

- Free-form corkboards or unrestricted evidence graphs.
- Natural-language or LLM-evaluated deductions.
- Alternate canonical culprits or branching truths.
- Hearing health, lives, consumable objections, or permanent failure.
- Quick-time events or real-time countdown puzzles.
- A large open world or second navigation engine.
- A full video pipeline in the first release.
- Replacing testimony cross-examination with analysis.
- Chapter-specific Svelte correctness rules.
- Generic mutable string flags.
- Generic negative unlock predicates.

## 6. Current repository baseline

The design deliberately starts from the repository as it exists, not from the desired end state.

### 6.1 Existing content and runtime flow

```text
Authored Markdown
    ↓
packages/scripts/compile-scenes
    ↓
validated generated JSON in Tauri resources
    ↓
Rust GameEngine
    ↓
public GameStateView
    ↓
Svelte presentation and semantic input
```

Current runtime scene variants are:

- `linear`,
- `investigation`,
- `interrogation`.

The current unlock grammar already uses positive predicates with `and` and `or`. This design extends that pattern rather than adding negation.

### 6.2 Existing `game/mod.rs` debt

On the reviewed `main` revision, `apps/game/src-tauri/src/game/mod.rs` is roughly 7,350 lines / 288 KB. It currently owns or coordinates:

- `GameEngine`,
- internal command rollback snapshots,
- scene loading and navigation,
- dialogue queue advancement and installation,
- opportunistic dialogue-history recording,
- many gameplay command implementations,
- inventory and reveal orchestration,
- view construction and scene transitions.

Therefore, “keep `game/mod.rs` as orchestration” is not merely a rule preventing future growth. A scoped seam extraction is a **P0.0 prerequisite** before save/runtime and analysis-runtime work expands the engine.

P0.0 is not a full rewrite. It extracts only the seams this program immediately needs:

- command transaction and rollback,
- dialogue queue lifecycle and history finalization,
- chapter/scene navigation,
- durable acquisition-event orchestration,
- save capture/restore entry points,
- analysis command dispatch when introduced.

After extraction, `game/mod.rs` remains the façade containing core engine ownership and delegating to focused modules. Acceptance is based on clear ownership and tests, not an arbitrary line-count target.

### 6.3 Current shared-type boundary

`@lyra/scene-types` contains only values that must be byte-identical between compiler/runtime/editor consumers. `DialogueItem` is deliberately **not** shared there because the layout editor uses a narrower presentation model.

Analysis types must preserve that boundary; the full authored/runtime board contract must not be placed wholesale in `@lyra/scene-types`.

### 6.4 Authored content roots

The compiler merges:

- `static/stories_plan/`,
- `docs/stories_plan/`.

A chapter must not exist in both roots. Chapter 1 currently lives under:

```text
docs/stories_plan/chapter_1/
```

Its current manifest contains `scene_8_5.md` as entry 13.

## 7. Architectural invariants

### 7.1 One-directional ownership

- Markdown is parsed only at build time.
- Generated resources are never hand-edited.
- Rust never parses authored Markdown.
- Svelte never contains accepted solutions or answer keys.
- Frontend drag animation and focus may be transient; board state is durable in Rust.

### 7.2 Monotonic progression

> Once content becomes visible or unlocked, later positive story-state mutations cannot hide or re-lock it.

The unlock language does not include generic `not`.

This keeps runtime behavior replay-safe and lets the compiler use positive fixed-point reachability.

### 7.3 Definitions are not mutable state

Authored labels, copy, accepted solutions, ordering, and dependencies are immutable compiled definitions. Saves contain stable references and mutable progress, not copied prose or solutions.

The compiler emits a game-wide catalog containing definitions needed outside the current scene:

```ts
type StoryCatalog = {
  facts: FactDefinition[];
  questions: QuestionDefinition[];
  objectives: ObjectiveDefinition[];
  authorizations: AuthorizationDefinition[];
  evidenceIndex: CaseRecordDefinitionIndex[];
  statementsIndex: CaseRecordDefinitionIndex[];
};
```

The focused compiler spec chooses the physical output file. This design requires global availability and the definition/state boundary.

### 7.4 Transient rollback and persistent saves have distinct types

The existing private command rollback clone must be renamed conceptually to:

```rust
EngineRollbackSnapshot
```

The serialized player-progress payload is:

```rust
SaveSnapshot
```

They serve different purposes and must not share the ambiguous name `GameSnapshot`.

## 8. Type ownership contract

| Type | Owner | Contains |
|---|---|---|
| `AnalysisBoardAst` | `packages/scripts/compile-scenes` | Parsed authored dialogue, reveals, hints, solutions, source locations |
| `AnalysisBoardJson` | Compiler output + Rust serde schema | Full validated runtime definition, including dialogue and accepted solution |
| `AnalysisBoardLayout` | `@lyra/scene-types` | Only byte-identical layout/geometry/presentation values needed by editor and runtime |
| `AnalysisBoardView` | Rust public view + frontend mirror | Available candidates, draft, completion, visible hints, feedback; never accepted solution |
| `AnalysisBoardSaveState` | Rust save schema | Draft, completion, failures, hint level, active-board state; no authored prose |

The illustrative board definitions in this document describe semantic ownership; they do not imply that `DialogueItem` belongs in `@lyra/scene-types`.

## 9. ID namespace contract

| ID type | Scope |
|---|---|
| Evidence | Game-global |
| Statement | Game-global |
| Fact | Game-global |
| Question | Game-global |
| Objective | Game-global; chapter-specific IDs use a chapter-qualified naming convention |
| Authorization | Game-global |
| Chapter | Game-global |
| Scene | Unique within chapter; durable reference uses chapter + scene |
| Analysis board | Scene-local; durable reference uses chapter + scene + board |
| Card/group/slot | Board-local or scene-local as declared |
| Hotspot/topic/sublocation | Investigation-scene-local |
| Map node | Investigation-scene-local |

```ts
type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};
```

Board completion and scene completion use distinct predicates or an explicitly qualified target kind.

## 10. Shared case-record provenance

Evidence and statements share `CaseRecordProvenance`.

```ts
type CaseRecordSourceKind =
  | "physical"
  | "testimony"
  | "digital"
  | "subjective"
  | "unspecified";

type RepresentationLayer =
  | "raw"
  | "sync"
  | "summary"
  | "composite"
  | "none";

type ProceduralStatus =
  | "unspecified"
  | "lead"
  | "reacquired"
  | "exhibit";

type RecordCompleteness =
  | "complete"
  | "partial"
  | "cropped"
  | "unspecified";

type RecordConfidence =
  | "unverified"
  | "corroborated"
  | "disputed"
  | "unspecified";

type ProofCapability =
  | "time"
  | "order"
  | "route"
  | "identity"
  | "access"
  | "motive"
  | "source"
  | "credibility"
  | "procedure"
  | "causation";

type CaseRecordProvenance = {
  sourceKind: CaseRecordSourceKind;
  representationLayer: RepresentationLayer;
  proceduralStatus: ProceduralStatus;
  completeness: RecordCompleteness;
  confidence: RecordConfidence;
  sourceGroupId: string | null;
  sourceLabel: string | null;
  proofCapabilities: ProofCapability[];
  supersedesRecordId: string | null;
};
```

### 10.1 Neutral legacy behavior

Legacy records use unspecified/empty defaults and remain visually unchanged.

An unspecified status cannot satisfy an explicit exhibit requirement. A board depending on procedure, source independence, completeness, or capabilities requires explicit metadata; missing required metadata is a compiler error.

### 10.2 Immutable record chain

Lead → reacquired → exhibit creates new records rather than mutating one record and erasing history.

```text
anonymous_social_clip_lead
    ↓ superseded by
verified_original_clip
    ↓ superseded by
hearing_exhibit_clip
```

Earlier records remain inspectable. This supports Chapter 1 screenshot → forensic fixed page, Chapter 2 online clip → verified original, and Chapter 8 lead → reacquired → exhibit.

## 11. Story-state definitions and mutable state

### 11.1 Facts

A fact is a durable conclusion, not physical evidence.

```ts
type FactDefinition = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
};

type AssertionOrigin =
  | { kind: "analysisBoard"; board: AnalysisBoardRef }
  | { kind: "investigationInteraction"; chapterId: string; sceneId: string; interactionId: string }
  | { kind: "hearingRuling"; chapterId: string; sceneId: string; phaseId: string }
  | { kind: "storyEvent"; chapterId: string; sceneId: string; eventId: string };

type FactState = {
  id: string;
  asserted: boolean;
  assertedInChapterId: string | null;
  assertedInSceneId: string | null;
  assertedBy: AssertionOrigin | null;
  supportingRecordIds: string[];
  supportingFactIds: string[];
};
```

Rust can compute the transitive supporting-record closure.

For the MVP, an independent-source threshold may select only evidence and statement cards. Facts and free case notes cannot manufacture additional independent sources.

### 11.2 Questions

```ts
type QuestionDefinition = {
  id: string;
  label: string;
  summary: string;
  resolvedByFactIds: string[];
};

type QuestionState = {
  id: string;
  revealed: boolean;
  status: "open" | "resolved";
};
```

Cross-chapter questions use neutral wording and are not marked as main-story clues.

### 11.3 Objectives: uniqueness by construction

The system represents the primary objective with one scalar field rather than trying to prove exclusivity across every reachable combination of independent statuses.

```ts
type ObjectiveDefinition = {
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
  sortOrder: number;
};

type ObjectiveProgress = {
  id: string;
  revealed: boolean;
  completed: boolean;
};

type StoryObjectiveState = {
  activePrimaryObjectiveId: string | null;
  objectives: ObjectiveProgress[];
};
```

A dedicated atomic reveal changes the primary objective:

```ts
type SetPrimaryObjectiveReveal = {
  kind: "setPrimaryObjective";
  completeCurrent: boolean;
  nextObjectiveId: string | null;
};
```

Rules:

- Rust structurally guarantees zero or one active primary objective.
- The compiler validates that `nextObjectiveId` exists and is declared `primary`.
- `sortOrder` is immutable authored metadata, not save state.
- The compiler may lint suspicious transition graphs, but the program does not claim exhaustive combinatorial proof of all objective activation orders.
- Continue and HUD summaries use `activePrimaryObjectiveId`.

### 11.4 Procedure authorizations

```ts
type AuthorizationDefinition = {
  id: string;
  label: string;
  summary: string;
  grantingAuthority: string;
};

type AuthorizationState = {
  id: string;
  granted: boolean;
  grantedInChapterId: string | null;
  grantedInSceneId: string | null;
  grantedBy: AssertionOrigin | null;
};
```

A detective workbench may prove that a request is justified. It cannot grant court, review-board, police, vendor, or building authority unless the authored resolution represents that authority.

Chapter 1 separates:

- request readiness in Beat 8.5,
- `narrow_lock_export` granted by the hearing.

## 12. Fourth scene type: `analysis`

### 12.1 Scene contract

The compiler recognizes `analysis_scene_<K>.md` and adds `analysis` to the scene union.

An analysis scene contains:

- scene identity/title,
- intro/outro dialogue,
- ordered board definitions,
- card and case-note sources,
- feedback and hints,
- accepted solutions and success reveals,
- semantic asset/audio references.

Global fact/question/objective/authorization definitions live in the story catalog. Scenes reference them.

Boards are a tagged union; generic untyped `config` objects are not allowed.

### 12.2 Board availability

Rust exposes:

- available boards,
- `activeBoardId`,
- completion state,
- durable draft per board,
- visible hints and latest feedback.

Rules:

- The engine may focus the first newly available incomplete required board.
- Players may select any available board.
- `required` controls scene completion, not accessibility.
- Completed boards reopen read-only.
- Optional boards cannot be the only source of a mandatory fact.
- Chapter 1 may author sequential boards without making the global runtime linear.

### 12.3 Card sources

```ts
type AnalysisCardSource =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "caseNote"; id: string; label: string; summary: string };
```

Accepted solutions exist only in compiled runtime definitions. Public views never expose them.

## 13. Analysis templates

### 13.1 MVP

**`classify`** — assign every required card to one authored group; one accepted group per required card.

**`order`** — place required cards in one canonical total order; fixed anchor cards may be immovable.

**`threshold`** — select eligible evidence/statement cards while satisfying:

- minimum selected count,
- minimum distinct source groups,
- required capabilities,
- allowed/prohibited procedural statuses,
- optional explicit eligible set.

Two records derived from one source group are not independent.

### 13.2 Expansion

**`compare`** — align records across authored columns/layers.

**`route`** — select/order declared nodes and edges through an authored graph, including separate outbound/return paths.

**`chain`** — connect declared cause, intervention, omission, and consequence nodes using accepted directed edges.

None of these are free-form editors.

## 14. Analysis runtime and transaction flow

1. Enter scene and install a stable intro dialogue segment.
2. Rust exposes available boards and retains/selects `activeBoardId`.
3. A completed interaction sends the complete typed draft to Rust.
4. Rust validates shape and stores the last valid draft.
5. Submit evaluates the stored draft.
6. A wrong well-formed submission returns gameplay feedback and preserves the draft.
7. A malformed draft returns a typed application error and preserves the previous valid draft.
8. A correct submission atomically commits:
   - accepted draft,
   - board completion,
   - fact/question/objective changes,
   - request readiness or authorization where appropriate,
   - inventory/provenance reveals,
   - durable acquisition events,
   - ordered result dialogue segments.
9. Failure rolls back the whole command transaction.
10. Repeated submission cannot replay durable effects.
11. The scene advances only after required boards and outro conditions are complete.

Durable effects commit before result dialogue displays. Dialogue segment state prevents reveal replay or skipped dialogue after resume.

## 15. Reveal, unlock, and reachability

Existing positive predicates remain. The shared language adds:

- `fact_asserted`,
- `question_resolved`,
- `objective_completed`,
- `analysis_board_completed`,
- `analysis_scene_completed`,
- `authorization_granted`,
- `at_least(count, conditions[])`.

`and` and `or` remain supported. There is no generic `not`.

Reveal targets include:

- open/resolve question,
- assert fact,
- reveal/complete objective progress,
- atomically set the primary objective,
- grant authorization from an authority event,
- reveal case records,
- unlock later content through positive state.

All reveal transactions are atomic and idempotent.

### 15.1 Positive fixed-point analysis

The compiler:

1. seeds initially available content,
2. applies reachable reveals,
3. re-evaluates positive expressions,
4. repeats to convergence,
5. errors on unreachable mandatory content,
6. warns on unreachable optional content.

It rejects:

- unresolved/duplicate IDs,
- ambiguous local references,
- self-reference and positive cycles,
- invalid `at_least` counts,
- unreachable required cards/facts/grants,
- incomplete classify/order solutions,
- unsatisfiable thresholds,
- missing provenance required by a rule,
- invalid routes/media mappings,
- invalid feedback/hint references,
- invalid primary-objective transition targets.

It does not claim an exhaustive combinatorial proof that independently authored objective transitions can never conflict; uniqueness is guaranteed by the scalar runtime representation.

## 16. Save, load, autosave, and Continue

### 16.1 User-facing behavior

- one rolling autosave,
- one previous-autosave backup,
- three manual slots,
- Continue loads the newest valid save,
- slot metadata includes chapter, scene, primary objective, save type, and update time,
- occupied manual slots require confirmation,
- corrupt/incompatible diagnostics do not silently erase files.

Saving is allowed only after a command commits and no mutation is in flight.

### 16.2 Ordered stable dialogue segments

The save system does not copy arbitrary authored dialogue prose and does not rely on frontend-only pending queues.

A runtime dialogue queue may be composed from multiple authored segments, such as several `onCollect`, `onAcquire`, result, or reveal segments.

```ts
type DialogueSegmentOrigin =
  | { kind: "linearScene"; chapterId: string; sceneId: string }
  | { kind: "investigationIntro"; chapterId: string; sceneId: string }
  | { kind: "investigationInteraction"; chapterId: string; sceneId: string; interactionId: string }
  | { kind: "interrogationPhase"; chapterId: string; sceneId: string; phaseId: string; segmentId: string }
  | { kind: "analysisIntro"; chapterId: string; sceneId: string }
  | { kind: "analysisResult"; chapterId: string; sceneId: string; boardId: string; segmentId: string }
  | { kind: "recordAcquisition"; recordKind: "evidence" | "statement"; recordId: string; segmentId: string }
  | { kind: "storyEvent"; chapterId: string; sceneId: string; eventId: string; segmentId: string };

type DialogueSegmentState = {
  origin: DialogueSegmentOrigin;
  definitionHash: string;
};

type ActiveDialogueQueueState = {
  segments: DialogueSegmentState[];
  activeSegmentIndex: number;
  cursorWithinSegment: number;
};
```

Rust reconstructs the ordered segments from compiled definitions.

### 16.3 Durable acquisition acknowledgement

```ts
type AcquisitionEventState = {
  id: string;
  recordKind: "evidence" | "statement";
  recordId: string;
  createdByCommandId: string;
  acknowledged: boolean;
};
```

The frontend displays unacknowledged events after their authored dialogue drains and acknowledges them through a command. Saving during acquisition dialogue cannot lose the eventual popup or replay inventory mutation.

### 16.4 Save envelope

```ts
type SaveEnvelope = {
  schemaVersion: number;
  contentRevision: string;
  saveId: string;
  saveType: "auto" | "manual";
  slot: number | null;
  createdAt: string;
  updatedAt: string;
  summary: SaveSummary;
  snapshot: SaveSnapshot;
};
```

`SaveSnapshot` stores stable IDs and mutable state, including:

- chapter/scene and scene runtime progress,
- ordered active dialogue segments and cursor,
- inventory and provenance references,
- unacknowledged acquisition events,
- story state and active primary objective ID,
- investigation/interrogation progress,
- analysis drafts/completion/failures/hints,
- dialogue history needed for exact resume,
- generation counters needed for stale-action rejection.

### 16.5 Autosave and storage

Autosave runs after successful durable mutations and never during an in-flight command.

The writer:

1. writes a temporary file,
2. flushes/fsyncs where supported,
3. rotates the current autosave to backup,
4. atomically replaces the current autosave.

Failure preserves the prior valid file and shows a persistent non-blocking warning.

### 16.6 Compatibility

Semantic ID existence alone is insufficient.

- `schemaVersion` controls data migrations.
- `contentRevision` identifies the compiled bundle.
- Active/incomplete scene, board, route, and dialogue-segment definitions carry hashes.
- Active/incomplete definitions require exact hashes or explicit migration.
- Completed boards survive changed definitions only through explicit migration preserving durable outputs.
- Optional state may be dropped only when dependency analysis proves no surviving state depends on it.
- Missing current/required definitions reject load transactionally.
- A corrupt primary autosave may fall back to backup.
- Files remain until the player deliberately replaces/deletes them.

Audio preferences remain separate.

## 17. Case file and recap

The MVP case file contains:

1. primary and secondary objectives,
2. evidence,
3. statements,
4. established facts,
5. open/resolved questions,
6. granted authorizations.

Rules:

- Existing re-examination remains available where valid.
- Facts cannot be selected as physical evidence.
- Superseded leads remain inspectable.
- Locked definitions are hidden.
- Cross-chapter questions are not marked as main-story clues.
- Continue uses authored chapter/scene copy and the active primary objective; no LLM recap.

People, locations, full chronology, and social archives remain later work.

## 18. Investigation-time record interactions

Investigation gains one generic action: use a collected evidence item or statement on an authored target.

Targets:

- character,
- topic,
- hotspot,
- sublocation interaction point.

An interaction declares accepted IDs/capabilities/statuses, correct dialogue, specific and generic wrong feedback, and atomic reveals.

Only authored targets expose the action. Wrong use never consumes a record or mutates story state.

## 19. Procedure gates

A typical sequence is:

1. investigation finds contradictions,
2. analysis establishes facts and completes request preparation,
3. hearing presents those facts,
4. authority grants a named authorization,
5. authorization unlocks access or a later phase.

Examples:

- Chapter 1: hearing grants `narrow_lock_export`.
- Chapter 6: hearing grants `limited_raw_export`, then `batch_raw_export`.
- Chapter 8: judge grants witness standing or exhibit admissibility.

Wrong requests remain retryable.

## 20. Feedback and hints

Feedback precedence:

1. exact record/combination,
2. prohibited procedural status,
3. duplicate source group,
4. missing capability,
5. structural incompleteness,
6. default feedback.

Hints may progress from restating the question to identifying a specific next record set. Hints never mutate facts, solve boards, or consume resources.

## 21. Media and map support

### 21.1 Static frame strips

Frame sets may define ordered assets, absolute timestamps, optional `S+` offsets, source/viewpoint metadata, provenance, annotations, and overlays.

`S+00m45s` must never be parsed or displayed as `00:45 a.m.`.

### 21.2 Staged investigation map

Map metadata owns only:

- node position,
- mapped sublocation ID,
- stage/cluster,
- optional edges,
- label/icon.

Visibility, lock, current, and completion derive from the mapped investigation sublocation. The map selects the same `currentSublocationId`; it is not a second navigation state.

## 22. Chapter 1 validation slice

The playable Chapter 1 source root is:

```text
docs/stories_plan/chapter_1/
```

Implementation must:

```text
Modify:  docs/stories_plan/chapter_1/chapter.md
Replace: docs/stories_plan/chapter_1/scene_8_5.md
Create:  docs/stories_plan/chapter_1/analysis_scene_8_5.md
```

Do not introduce a duplicate `chapter_1` under `static/stories_plan/`.

### 22.1 Boards

1. **Evidence packages (`classify`)**
   - Miyake’s known small lies unrelated to murder.
   - Earlier third-party contractor route.
   - Lock chronology.
2. **Local event sequence (`order`)**
   - `Event-1841` through `Event-1844`.
   - Local order is not an exact timestamp.
3. **Narrow-request basis (`threshold`)**
   - At least two independent contradictions challenging lock chronology.
   - Same-source records fail.

### 22.2 Outputs

Facts:

- `miyake_known_lies_are_unrelated_to_murder`
- `earlier_external_entry_exists`
- `merge_time_is_not_event_time`
- `two_independent_lock_contradictions_identified`

Objective progress:

- complete `prepare_narrow_lock_request`

Beat 8.5 does not grant `narrow_lock_export`.

The hearing consumes the facts/objective, grants `narrow_lock_export`, reveals the limited extract, and continues the existing proof order.

## 23. Chapter 2 validation slice

Chapter 2 uses Phase A/B/C and no more than 7–8 mandatory locations. Optional side stories cannot be the only source of required facts.

### 23.1 Boards

1. **Sightline (`classify`)** — box, wall, Program Composite, side/direct view.
2. **Image source (`compare`)** — wall, fan phone, Program Composite, low-frame QA.
3. **Control-room reaction (`order`)** — director fault classification → AD standby call → Hasumi response → PR template → security leaves route unsealed.
4. **Route (`route`)** — outbound safety position → sponsor corridor → M-03 → service lift B → vacant floor; separate return route; expired pass cannot be reused.
5. **Person/capability** — Saneda’s malice without access versus Hasumi’s access, first-response control, and urgent motive.

### 23.2 Facts

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

Access, control, and motive remain separate proof functions.

### 23.3 Constraints

- Wall-derived clips share one source group.
- QA frames prove route, not identity.
- The pass proves outbound access, not return.
- `S+` is relative time, not clock time.
- Amemiya’s message is not the unique mandatory route.
- Online material begins as lead and must be formally reacquired.
- Hasumi planned isolation/control; killing escalated after control failed.
- No Chapter 2-specific evaluator logic outside reusable authored templates.

## 24. Accessibility and interaction

- Every drag action has a select/move/confirm keyboard path.
- Semantic controls expose card/group/slot/node/connection state.
- No result is color-only.
- Feedback/hints use live regions and restore focus.
- Escape follows the existing one-layer-per-press coordinator.
- Modal surfaces manage focus and inertness.
- Reduced motion removes nonessential movement.
- Required controls remain visible at 1280×720.
- Source tests ensure Svelte contains no solution branches.

## 25. Failure handling

- Invalid draft shape preserves the last valid draft.
- Wrong well-formed submissions are gameplay feedback.
- Stale actions are rejected with generation tokens.
- Multi-reveal commands are transactional.
- Save/load failures preserve valid state/files.
- Optional missing media uses placeholders.
- Missing required content is a compile-time error.
- Debug navigation creates valid prerequisites only in debug builds.

## 26. Verification strategy

### Compiler

- global catalog and ID tests,
- parser/emitter fixtures,
- positive fixed-point reachability,
- invalid thresholds/routes/time maps/provenance/objective transitions,
- Rust serde snapshots.

### Rust

- story-state and reveal tests,
- provenance/support lineage,
- transaction rollback,
- template evaluation,
- source independence,
- request versus authority grant,
- exact acquisition acknowledgement,
- `EngineRollbackSnapshot` transaction coverage,
- `SaveSnapshot` round trips,
- composite dialogue-segment reconstruction,
- definition-hash and migration tests,
- full Chapter 1 playthrough.

### Frontend

- case-file sections,
- keyboard/pointer parity,
- focus/Escape/inert behavior,
- feedback/hints,
- acquisition acknowledgement after resume,
- save slots/Continue,
- dual time display,
- map-derived state,
- reduced motion.

### End to end

The packaged Tauri app proves:

- new game through Chapter 1 hearing,
- exact resume from every incomplete Chapter 1 board,
- exact resume from multi-segment result/acquisition dialogue,
- same-source threshold rejection,
- request readiness in analysis,
- authorization only in hearing,
- title → Continue,
- manual overwrite,
- Chapter 2 map and five-board golden path when implemented.

## 27. Rollout

- P0.0 extracts engine seams before save/runtime and analysis-runtime growth.
- Save/load may ship before authored analysis.
- New catalog/state defaults empty for legacy content.
- `analysis` enters Chapter 1 only after P0/P1 contracts stabilize.
- Legacy records remain usable but cannot satisfy metadata rules without metadata.
- Existing investigation/interrogation Markdown remains valid.
- Layout-editor support begins read-only.
- Every template requires compiler, Rust, frontend, and authored acceptance coverage.
- Chapter 2 starts only after the Chapter 1 packaged acceptance gate.

## 28. Required focused specifications

Before implementation, approve focused specifications and executable plans for:

1. P0.0 engine seam extraction.
2. Global catalog, story state, provenance, support lineage, and monotonic reveals.
3. Save snapshot, ordered dialogue segments, acquisition events, hashes, and migrations.
4. Analysis Markdown/compiler contract and reachability.
5. Rust analysis runtime, transactions, and public views.
6. Workbench interaction/accessibility.
7. Chapter 1 analysis and hearing handoff.
8. Investigation-time record interaction.
9. Chapter 2 map/media/compare/route/control-room expansion.

This umbrella design defines shared invariants. It does not authorize one all-at-once implementation branch.

## Tracking (non-normative)

At the time of writing:

- originating pull request: GitHub #23,
- program tracking issue: Linear HPA-254.

Tracking identifiers may change and do not define the architecture.