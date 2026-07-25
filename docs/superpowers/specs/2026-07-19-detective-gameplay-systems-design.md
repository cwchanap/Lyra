# Detective Gameplay Systems Design

**Date:** 2026-07-19  
**Revised:** 2026-07-21  
**Status:** Proposed for final approval  
**Scope:** Additive detective-reasoning, persistence, story-state, provenance, and Chapter 1/2 integration architecture. Each subsystem still requires a focused design and executable implementation plan before code changes begin.

## 1. Normative source and narrative precedence

This file is the **program-level normative architecture and gameplay contract**
for the additive detective-gameplay systems program:

```text
docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md
```

The approved focused HPA-129 design at
`docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`
is the incorporated normative refinement of §§7.4 and 16. Where the two
documents differ on persistence behavior, HPA-129 controls: five visible
rotating autosaves replace the current-plus-backup model, and Continue targets
the newest written save without silently falling back when it is invalid.

The companion implementation plan defines sequencing, repository ownership, ticket mapping, and verification gates. It may summarize requirements for execution context, but it must not create a competing behavioral contract.

Existing approved investigation and interrogation specifications remain authoritative for their shipped behavior, including:

- `docs/superpowers/specs/2026-05-04-detective-investigation-design.md`
- `docs/superpowers/specs/2026-07-06-interrogation-detective-beats-design.md`

This document governs the additive analysis, persistence, story-state, provenance, and Chapter 1/2 integration layer. It overrides an existing subsystem contract only where a section explicitly names that change.

Where narrative documents disagree, use this order:

1. Chapter 1 Final Writing Plan V3.7.
2. Chapter 2 Plan V0.7 Timecode / Control-Room Reaction Lock.
3. Story Bible V6.5 Canon Sync Patch.
4. Story Bible V6.4.
5. Older handover notes and review drafts.

This prevents implementation from restoring superseded Chapter 1 timing, the old Chapter 2 one-way-glass or forged-work-order explanation, premature `ZW_A16.lock` decoding, or obsolete duration targets.

## 2. Summary

Lyra currently supports this loop:

1. read linear dialogue,
2. investigate hotspots and interview characters,
3. collect evidence and statements,
4. challenge testimony,
5. present one record against one contradiction.

The story requires a missing middle step: players must organize several individually truthful fragments into an explicit inference before using that inference in a hearing.

The central addition is a fourth compiler-driven scene type, `analysis`, backed by Rust-owned deterministic state and reusable typed board templates. It does not replace investigation or interrogation.

The program also adds:

- exact save/load, autosave, and Continue,
- first-class facts, questions, objectives, and named authorizations,
- shared case-record provenance and support lineage,
- a case file separating records from conclusions,
- contextual wrong-answer feedback and authored hints,
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
- Preserve existing `linear`, `investigation`, and `interrogation` behavior unless content opts into a new feature or this document explicitly changes a shared contract.
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
- A one-branch or one-release implementation of the whole program.

## 6. Current repository baseline

The design deliberately starts from the repository as reviewed, not from the desired end state. Baseline measurements are historical context, not permanent acceptance targets.

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

On the reviewed `main` revision, `apps/game/src-tauri/src/game/mod.rs` was roughly 7,350 lines / 288 KB. It owned or coordinated:

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

Its manifest contains the playable `scene_8_5.md` entry that P2 replaces.

## 7. Architectural invariants

### 7.1 One-directional ownership

```text
Authored Markdown
    ↓ build time
Compiler AST and validation
    ↓
Global story catalog + scene JSON
    ↓ runtime
Rust GameEngine and durable state
    ↓
Answer-key-free public views
    ↓
Svelte presentation and semantic commands
```

- Markdown is parsed only at build time.
- Generated resources are never hand-edited.
- Rust never parses authored Markdown.
- Svelte never contains accepted solutions or answer keys.
- Frontend-local drag animation and focus state may be transient; board progress is Rust-owned.

### 7.2 Positive monotonic progression

Ordinary authored progression is monotonic:

> Once content becomes visible or unlocked, later positive story-state mutations cannot hide or re-lock it.

The unlock language does not include generic `not`.

### 7.3 Definitions are not mutable state

Authored labels, descriptions, accepted solutions, display order, and dependencies are immutable compiled definitions. Saves contain stable IDs, definition hashes, and mutable progress—not copied authored prose or answer keys.

The compiler emits a game-wide catalog for definitions needed across scenes:

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

The focused compiler specification chooses the physical file layout. This design fixes ownership and availability.

### 7.4 Engine seams and snapshot terminology

The existing internal transaction clone is named conceptually:

```text
EngineRollbackSnapshot
```

Persistent player progress is named:

```text
SaveSnapshot
```

They are different contracts. Command rollback may clone runtime-owned objects for atomic restoration; persistent saves store stable IDs and mutable state according to §16.

New commands use shared transaction and dialogue-history delegates extracted in P0.0 rather than reproducing local `snapshot/restore` or `view_with_history()` conventions.

## 8. Analysis type ownership

The analysis contract is deliberately split by layer:

| Type | Owner | Contains |
|---|---|---|
| `AnalysisBoardAst` | compiler | authored dialogue, reveals, hints, source locations, accepted solution |
| `AnalysisBoardJson` | generated runtime schema / Rust serde | full validated runtime definition |
| `AnalysisBoardLayout` | `@lyra/scene-types` | only shared layout, geometry, and presentation values |
| `AnalysisBoardView` | Rust public view / frontend mirror | candidates, draft, status, feedback, visible hints; no answer key |
| `AnalysisBoardSaveState` | Rust save schema | mutable draft, completion, attempts, hints, active selection; no authored prose |

`DialogueItem` remains outside `@lyra/scene-types`.

## 9. ID namespace contract

| ID type | Scope |
|---|---|
| Evidence | game-global |
| Statement | game-global |
| Fact | game-global |
| Question | game-global |
| Objective | game-global; chapter-specific names should be qualified by convention |
| Authorization | game-global |
| Chapter | game-global |
| Scene | unique within chapter; durable refs use chapter + scene |
| Analysis board | scene-local; durable refs use chapter + scene + board |
| Card/group/slot | owning board or scene |
| Hotspot/topic/sublocation/map node | owning investigation scene |

```ts
type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};
```

Board-completed and scene-completed predicates must be distinct or explicitly target-kind-qualified.

## 10. Shared case-record provenance

Evidence and statements share `CaseRecordProvenance`.

```ts
type CaseRecordProvenance = {
  sourceKind:
    | "physical"
    | "testimony"
    | "digital"
    | "subjective"
    | "unspecified";
  representationLayer:
    | "raw"
    | "sync"
    | "summary"
    | "composite"
    | "none";
  proceduralStatus:
    | "unspecified"
    | "lead"
    | "reacquired"
    | "exhibit";
  completeness:
    | "complete"
    | "partial"
    | "cropped"
    | "unspecified";
  confidence:
    | "unverified"
    | "corroborated"
    | "disputed"
    | "unspecified";
  sourceGroupId: string | null;
  sourceLabel: string | null;
  proofCapabilities: ProofCapability[];
  supersedesRecordId: string | null;
};

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
```

### 10.1 Neutral legacy behavior

Legacy records receive unspecified/empty defaults and remain visually unchanged. Unspecified status cannot satisfy a rule that explicitly requires an exhibit, source independence, completeness, or proof capability.

If a board depends on metadata, missing required metadata is a compiler error.

### 10.2 Immutable record chains

Lead → reacquired → exhibit is represented by separate immutable records:

```text
anonymous_social_clip_lead
    ↓ superseded by
verified_original_clip
    ↓ superseded by
hearing_exhibit_clip
```

Earlier records remain inspectable. Later records carry their own acquisition/procedure origin.

## 11. Story-state definitions and mutable progress

### 11.1 Facts and support lineage

A fact is a durable proposition, not a physical record.

```ts
type FactDefinition = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
};

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

The engine can compute transitive supporting-record closure.

For MVP source-independent threshold boards, selectable counting inputs are evidence and statements only. Facts and free case notes cannot manufacture an additional source count.

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

Cross-chapter questions use neutral wording and are never marked as main-story spoilers.

### 11.3 Objectives: structural primary uniqueness

Primary-objective uniqueness is structural rather than an exhaustive compiler model-checking promise.

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

A dedicated atomic reveal sets or clears the active primary objective:

```ts
type SetPrimaryObjectiveReveal = {
  kind: "setPrimaryObjective";
  completeCurrent: boolean;
  nextObjectiveId: string | null;
};
```

The compiler validates target existence and `kind: primary`. It may lint suspicious transition graphs, but runtime uniqueness follows from the single scalar field.

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

An internal workbench may establish request readiness, but it cannot grant a court, police, vendor, building, or review-board authorization unless the represented authority performs the authored grant event.

## 12. Fourth scene type: `analysis`

The compiler recognizes `analysis_scene_<K>.md` and adds `analysis` to the runtime scene union.

An analysis scene contains:

- scene identity and title,
- intro dialogue,
- ordered board definitions,
- card sources and authored case notes,
- feedback and hint definitions,
- success reveals,
- outro dialogue and completion rules,
- semantic asset/audio references.

Game-global story definitions live in the catalog; scenes reference them.

### 12.1 Board availability and navigation

Rust exposes:

- currently available boards,
- `activeBoardId`,
- completion state,
- durable drafts,
- visible hints and latest feedback.

Rules:

- The engine may auto-focus the first newly available incomplete required board.
- Players may select any available board.
- `required` affects scene completion, not accessibility.
- Completed boards reopen read-only.
- Optional boards cannot be the only source of a mandatory fact.

### 12.2 Card sources

```ts
type AnalysisCardSource =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "caseNote"; id: string; label: string; summary: string };
```

Public views never expose accepted mappings, orders, paths, or edge sets.

## 13. Analysis templates

### 13.1 MVP templates

#### `classify`

Assign every required card to one authored group. MVP supports one accepted group per required card.

#### `order`

Place every required card in one canonical total order. Fixed anchor cards may be non-draggable.

#### `threshold`

Select a minimum number of eligible evidence/statement cards while satisfying authored constraints:

- minimum selection count,
- minimum distinct source groups,
- required proof capabilities,
- allowed/prohibited procedural statuses,
- optional explicit eligible set.

### 13.2 Expansion templates

#### `compare`

Align authored records across columns/layers and identify differing meaning or limitation.

#### `route`

Select and order authored graph nodes/edges with mandatory nodes, access requirements, and time windows. No freehand drawing.

#### `chain`

Connect declared cause, intervention, omission, and consequence nodes using accepted directed edge sets. Multiple contributors are supported.

## 14. Analysis runtime and atomic resolution

1. Entering an analysis scene plays intro through stable authored dialogue segments.
2. Rust exposes available boards and retains `activeBoardId`.
3. A complete typed draft is sent to Rust after each meaningful interaction.
4. Rust validates shape and stores the last valid draft durably.
5. Submit evaluates the stored draft.
6. Wrong well-formed submissions return gameplay feedback and preserve the draft.
7. Malformed drafts return typed application errors and preserve the previous draft.
8. Correct submission atomically commits:
   - accepted draft,
   - board completion,
   - fact/question/objective mutations,
   - request readiness or represented authority grant,
   - inventory/provenance reveals,
   - durable acquisition events,
   - ordered result-dialogue segments.
9. Any failed reveal restores the pre-command `EngineRollbackSnapshot`.
10. Repeated correct submissions cannot replay durable effects.
11. Scene completion occurs after required boards and outro rules complete.

Durable resolution commits before result dialogue displays. Resume restores the active segment and cursor without repeating reveals or skipping dialogue.

## 15. Reveal, unlock, and compiler reachability

The shared positive language supports:

- existing predicates,
- `fact_asserted`,
- `question_resolved`,
- `objective_completed`,
- qualified analysis board/scene completion,
- `authorization_granted`,
- `and`, `or`,
- `at_least(count, nonEmptyConditions)`.

There is no generic `not`.

Reveal targets include:

- reveal/open question,
- assert fact,
- complete secondary objective,
- atomic `setPrimaryObjective`,
- mark request readiness through fact/objective state,
- grant authorization from an authored authority event,
- reveal records,
- unlock later content through positive state.

All reveal transactions are atomic and idempotent.

### 15.1 Positive fixed-point analysis

The compiler:

1. seeds initially available content,
2. applies reachable positive reveals,
3. re-evaluates positive expressions,
4. repeats to convergence,
5. errors on unreachable mandatory content and mandatory grants,
6. warns on unreachable optional content.

It also validates:

- duplicate/unresolved IDs and ambiguous local refs,
- self-reference and positive cycles,
- invalid `at_least` counts,
- required cards that never become visible,
- facts that cannot be asserted,
- grants with no represented authority path,
- invalid primary-objective targets,
- incomplete classify/order solutions,
- unsatisfiable thresholds,
- missing required provenance,
- invalid route/media definitions,
- unresolved feedback/hint references.

It does **not** promise exhaustive combinatorial proof of every possible objective-transition ordering.

## 16. Save, load, autosave, and Continue

> **Normative HPA-129 refinement:** Follow
> `docs/superpowers/specs/2026-07-25-hpa-129-save-load-autosave-continue-design.md`
> for implementation. Its five visible rotating autosaves and
> newest-written-save/no-fallback Continue behavior supersede the baseline
> autosave, backup, and “newest valid” bullets below.

### 16.1 User-facing behavior

Lyra provides:

- one rolling autosave,
- one previous-autosave backup,
- three manual slots,
- Continue loading the newest valid save,
- chapter/scene/primary-objective/save-type/update-time metadata,
- overwrite confirmation,
- clear corrupt/incompatible diagnostics without silent deletion.

Saving is allowed after a command commits and no mutation is in flight.

### 16.2 Ordered dialogue segments and acquisition events

Saves do not copy arbitrary authored prose or rely on frontend-only pending queues.

An active dialogue queue is reconstructed from an ordered list of stable authored segments:

```ts
type DialogueSegmentOrigin =
  | { kind: "linearScene"; chapterId: string; sceneId: string }
  | { kind: "investigationIntro"; chapterId: string; sceneId: string }
  | { kind: "investigationInteraction"; chapterId: string; sceneId: string; interactionId: string; segmentId: string }
  | { kind: "interrogationPhase"; chapterId: string; sceneId: string; phaseId: string; segmentId: string }
  | { kind: "analysisIntro"; chapterId: string; sceneId: string }
  | { kind: "analysisResult"; chapterId: string; sceneId: string; boardId: string; segmentId: string }
  | { kind: "storyEvent"; chapterId: string; sceneId: string; eventId: string; segmentId: string };

type ActiveDialogueState = {
  segments: Array<{
    origin: DialogueSegmentOrigin;
    definitionHash: string;
  }>;
  activeSegmentIndex: number;
  itemCursor: number;
};
```

Rust reconstructs the queue from packaged definitions.

Acquisition acknowledgement is durable:

```ts
type AcquisitionEventState = {
  id: string;
  recordKind: "evidence" | "statement";
  recordId: string;
  createdByCommandId: string;
  acknowledged: boolean;
};
```

The frontend displays unacknowledged events after authored dialogue drains and acknowledges them through a command.

### 16.3 Save envelope

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

- current chapter and scene,
- current scene runtime progress,
- ordered dialogue segment state,
- inventory IDs/acquisition metadata,
- unacknowledged acquisition events,
- facts/questions/objectives/authorizations,
- investigation/interrogation/analysis progress,
- dialogue history needed for exact resume,
- generation counters used to reject stale actions.

### 16.4 Storage and compatibility

Autosave runs after committed durable mutations. It writes a temporary file, flushes, rotates the previous backup, and atomically replaces the current autosave where supported.

Compatibility rules:

- `schemaVersion` controls data migrations.
- `contentRevision` identifies the compiled story bundle.
- Active/incomplete scenes, boards, routes, and dialogue segments carry definition hashes.
- Active/incomplete definitions require exact hashes or explicit migrations.
- Completed historical boards may survive changes only through migrations preserving durable outputs.
- Optional state may be dropped only when dependency analysis proves no surviving state depends on it.
- Missing current/required definitions reject load transactionally.
- Corrupt primary autosave may fall back to the previous backup.
- Corrupt/incompatible files remain until deliberate replacement/deletion.

Audio preferences remain separate settings.

## 17. Case file, objective, and recap

The MVP case file contains:

1. Current Objective — one active primary plus optional secondary/recently completed items.
2. Evidence — details, provenance, source group, procedure, proof capabilities, supersession.
3. Statements — copy and provenance where authored.
4. Established Facts — player-established conclusions and support origin.
5. Open Questions — neutral open/resolved problems.
6. Authorizations — granted permissions and granting authority.

Rules:

- Existing re-examination remains available in valid modes.
- Facts cannot be selected as physical evidence.
- Superseded leads remain inspectable.
- Locked definitions are hidden.
- Save/Continue summaries use authored copy plus the active primary objective.
- No LLM recap is required.

People, locations, full chronology, and social-response archives are deferred.

## 18. Investigation-time record interactions

Investigation gains a generic authored action: use evidence or a statement on a character, topic, hotspot, or sublocation interaction point.

An interaction declares accepted IDs or capability/status requirements, correct dialogue, contextual wrong feedback, and atomic reveals.

Only authored targets expose the action. Wrong use never consumes a record or mutates durable story state.

## 19. Procedure gates

Procedure is modeled by request readiness plus named authorizations—not a score.

Typical sequence:

1. investigation finds contradictions,
2. analysis establishes facts and completes request preparation,
3. a hearing presents those facts,
4. the represented authority grants a named authorization,
5. the authorization unlocks limited access or a later phase.

Examples:

- Chapter 1: prepare narrow lock request → hearing grants `narrow_lock_export`.
- Chapter 6: three-source contradiction → `limited_raw_export`, later `batch_raw_export`.
- Chapter 8: reacquired identity/provenance package → witness standing or exhibit admissibility.

Wrong requests receive reasoned denial and remain retryable.

## 20. Feedback and hints

Feedback precedence:

1. exact record/combination,
2. prohibited procedural status,
3. duplicate source group,
4. missing proof capability,
5. structural incompleteness,
6. default feedback.

Examples:

- “This establishes time, not identity.”
- “Both clips derive from the broadcast wall.”
- “This source is still only a lead.”
- “The route reaches the vacant floor but not the return path.”

Boards may define four authored hint levels:

1. restate the question,
2. identify the relevant package/layer,
3. identify the missing capability/independence rule,
4. identify the specific next record or connection.

Hints never mutate facts, solve boards, or consume resources.

## 21. Media and map support

### 21.1 Static frame-strip viewer

The first media feature uses authored still frames, not video decoding. A frame set may define ordered assets, absolute times, a relative axis such as `S+`, source/viewpoint labels, provenance, annotations, and overlays.

Absolute and `S+` times can display together. `S+00m45s` is never parsed as `00:45 a.m.`

### 21.2 Staged investigation map

Map metadata owns only:

- normalized node position,
- mapped sublocation ID,
- phase/cluster,
- optional edges,
- label/icon.

Visible, locked, current, and completed states derive from the mapped investigation sublocation. The map uses the same `currentSublocationId` as ordinary navigation and creates no duplicate progress state.

## 22. Chapter 1 vertical slice

P2 modifies the existing Chapter 1 source only:

```text
Modify:  docs/stories_plan/chapter_1/chapter.md
Replace: docs/stories_plan/chapter_1/scene_8_5.md
Create:  docs/stories_plan/chapter_1/analysis_scene_8_5.md
```

Do not create a duplicate Chapter 1 under `static/stories_plan/`.

The existing transition dialogue moves into analysis intro/outro.

### 22.1 Required boards

1. Evidence packages (`classify`)
   - Miyake’s known small lies unrelated to murder.
   - Earlier third-party contractor route.
   - Lock chronology.
2. Local event sequence (`order`)
   - `Event-1841` through `Event-1844`.
   - Local order is not an exact timestamp.
3. Narrow-request basis (`threshold`)
   - At least two independent evidence/statement contradictions challenging lock chronology.
   - Same-source pairs fail.

### 22.2 Outputs and hearing handoff

Facts:

- `miyake_known_lies_are_unrelated_to_murder`
- `earlier_external_entry_exists`
- `merge_time_is_not_event_time`
- `two_independent_lock_contradictions_identified`

Objective progress:

- complete `prepare_narrow_lock_request`

Beat 8.5 does **not** grant `narrow_lock_export`.

The final hearing consumes the facts/objective. The review authority grants `narrow_lock_export`, reveals the limited extract, and continues the existing proof order.

Chapter 1 is the packaged acceptance gate for persistence, catalog/state, provenance, monotonic progression, analysis compiler/runtime/UI, MVP templates, case file, feedback/hints, procedure ownership, accessibility, and exact resume.

## 23. Chapter 2 expansion

Chapter 2 validates flexible investigation order and richer source reasoning. The Phase A/B/C map keeps the golden path within 7–8 mandatory locations; optional investigations cannot be the only source of a required fact.

### 23.1 Required boards

1. Sightline (`classify`)
   - box,
   - broadcast wall,
   - Program Composite,
   - side/direct view.
2. Image source (`compare`)
   - broadcast wall,
   - fan phone,
   - Program Composite,
   - low-frame QA records.
3. Control-room reaction (`order`)
   - director identifies apparent projection/sync fault,
   - AD calls back standby,
   - Hasumi answers for Mashiro,
   - PR opens the technical-incident template,
   - security leaves M-03/service lift unsealed while the request remains valid.
4. Route (`route`)
   - outbound safety position → sponsor corridor → M-03 → service lift B → vacant floor,
   - separate stairs/rear-exit return,
   - expired sponsor pass cannot be reused.
5. Person/capability
   - Saneda’s malice and streaming knowledge,
   - Hasumi’s sponsor access,
   - Hasumi’s first-response control position,
   - Hasumi’s urgent financial/control motive.

### 23.2 Resulting facts

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

The culprit conclusion requires route, access, response control, and motive as separate proof functions.

### 23.3 Constraints

- Wall-derived fan clips share one source group.
- QA frames prove movement/route, not identity.
- The fifteen-minute pass proves outbound access, not return.
- `S+` is a sponsor-block offset, not clock time.
- Amemiya’s “Don’t look at the wall” is one route, not the unique path.
- Online material begins as a lead and must be formally reacquired before hearing use.
- Hasumi planned isolation/control; killing escalated when control failed.
- No Chapter 2-specific evaluator logic exists outside authored data and reusable templates.

## 24. Frontend interaction and accessibility

- Every drag action has a select/move/confirm keyboard equivalent.
- Cards, groups, slots, nodes, and connections expose semantic names and state.
- No result is communicated by color alone.
- Feedback and hints use live regions and restore focus appropriately.
- Escape follows the existing one-layer-per-press coordinator.
- Modal surfaces manage focus and inertness correctly.
- Reduced motion removes card-flight, line-draw, and result animation.
- Analysis cannot submit from accidental background clicks.
- Required controls remain visible at 1280×720.
- Source tests prove Svelte contains no accepted solution or correctness branch.

## 25. Failure handling

- Invalid draft shape returns a typed error and preserves the last valid draft.
- Wrong well-formed submission returns gameplay feedback.
- Stale actions are rejected through generation tokens.
- Multi-reveal commands are transactional.
- Save failure preserves the previous valid save.
- Load failure never partially mutates the engine.
- Missing optional media assets use existing placeholders and do not block logic.
- Missing required authored definitions are compile-time errors.
- Debug navigation may grant prerequisites only in debug builds and must construct valid state rather than bypass invariants.

## 26. Testing strategy

### Compiler

- catalog definition and ID tests,
- parser/emitter fixtures for every template,
- invalid duplicate/reference/threshold/cycle/route/time/provenance fixtures,
- positive fixed-point reachability,
- invalid primary-objective transition tests,
- Rust serde compatibility snapshots.

### Rust

- story-state and monotonic reveal tests,
- provenance/support-lineage tests,
- typed draft and stale-token tests,
- evaluators for implemented templates,
- source independence tests,
- request-readiness versus authority-grant tests,
- atomic resolution and exactly-once acquisition tests,
- save/load round trips,
- ordered dialogue reconstruction,
- definition-hash and migration tests,
- investigation record-interaction tests,
- full Chapter 1 playthrough.

### Frontend

- case-file sections and neutral legacy rendering,
- pointer/keyboard parity,
- focus/Escape/inert behavior,
- feedback/hint announcements,
- acquisition acknowledgement after resume,
- save/Continue behavior,
- dual-time display,
- map-derived state,
- reduced motion.

### Packaged Tauri e2e

- new game through Chapter 1 analysis and hearing,
- save during every incomplete Chapter 1 board,
- save during multi-segment result/acquisition dialogue,
- wrong same-source feedback,
- request readiness in analysis,
- authorization only in hearing,
- return to title and Continue,
- manual overwrite confirmation,
- Chapter 2 staged-map/five-board path when P3 lands.

## 27. Rollout and compatibility

- P0.0 extracts required seams before Rust-heavy persistence/analysis integration.
- Save/load may ship before authored analysis content.
- Catalog/state collections default empty for legacy content.
- `analysis` enters Chapter 1 only after P0/P1 contracts stabilize.
- Legacy records remain visually unchanged but cannot satisfy metadata-dependent rules without metadata.
- Existing investigation/interrogation Markdown remains valid except for explicitly documented additive integrations.
- Layout-editor support begins read-only.
- Every template requires compiler, Rust, frontend, accessibility, and authored acceptance coverage.
- Chapter 2 remains blocked until the full Chapter 1 packaged gate passes.

## 28. Alternatives not chosen

### Bespoke minigame per chapter

Rejected because it duplicates state, validation, accessibility, persistence, authoring, and tests.

### Frontend-only analysis

Rejected because it exposes answer keys and violates Rust ownership.

### Free-form deduction graph

Rejected because it is difficult to author, validate, hint, save, test, and make accessible.

### Generic negation

Rejected because it permits re-locking and destabilizes reachability/order semantics.

### Numeric hearing health

Rejected because punishment does not model procedural stakes; named grants and reasoned denial do.

### Full video pipeline first

Deferred because still frames and dual time axes prove the requirement with less packaging risk.

### Serialize full authored dialogue in saves

Rejected because it freezes copied prose. Stable ordered segment origins and hashes preserve exact resume.

## 29. Program acceptance criteria

The program-level design is satisfied when:

- P0.0 establishes safe transaction/dialogue/navigation seams,
- the game saves every durable state and pending acknowledgement,
- definitions and mutable state are separated,
- provenance and support lineage are first-class,
- progression remains monotonic and mandatory paths are compiler-reachable,
- an authored `analysis` scene runs without frontend answer keys,
- Chapter 1 prepares a request while the hearing grants authorization,
- the case file separates records, conclusions, objectives, questions, and grants,
- wrong submissions explain proof limits without making the case unwinnable,
- Chapter 2 distinguishes shared sources, reconstructs the response order, compares media, and proves outbound/return routes,
- investigation can use records on authored targets,
- all new behavior passes compiler, Rust, frontend, accessibility, persistence, and packaged Tauri gates,
- later chapters add templates without bespoke runtime modes.

## 30. Required focused specifications

Before implementation, approve focused specs and executable plans for:

1. P0.0 engine transaction/dialogue/navigation seam extraction.
2. Global catalog, story state, provenance, support lineage, and monotonic reveals.
3. Save snapshot, ordered dialogue segments, acquisition events, hashes, and migration.
4. Analysis Markdown/compiler contract and positive reachability.
5. Rust analysis runtime, transaction, and public-view contract.
6. Workbench interaction and accessibility.
7. Chapter 1 Beat 8.5 and hearing handoff.
8. Investigation-time record use.
9. Chapter 2 map/media/compare/route/response expansion.

This umbrella design defines shared invariants. It does not authorize one all-at-once implementation branch.
