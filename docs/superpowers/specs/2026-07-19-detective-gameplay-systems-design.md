# Detective Gameplay Systems Design

**Date:** 2026-07-19  
**Revised:** 2026-07-21  
**Status:** Revised after architectural self-review; pending final approval  
**Scope:** Shared detective-gameplay architecture, persistence, and the Chapter 1/2 vertical slices. Each major subsystem still requires a focused design and executable implementation plan before code changes begin.

## 1. Canonical source of truth

This document and its companion high-level plan are the canonical program documents for the detective-gameplay work.

- Canonical design: `docs/superpowers/specs/2026-07-19-detective-gameplay-systems-design.md`
- Canonical plan: `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-high-level-plan.md`
- Normative decisions: `docs/superpowers/plans/2026-07-19-detective-gameplay-systems-decision-locks.md`
- Tracking parent: Linear `HPA-254`

The parallel “Detective Gameplay Foundations” proposal and Linear `HPA-239` tree are superseded. Future implementation and review must not mix contracts from both proposals.

### Narrative canon precedence

Where narrative documents disagree, use this order:

1. Chapter 1 Final Writing Plan V3.7.
2. Chapter 2 Plan V0.7 Timecode / Control-Room Reaction Lock.
3. Story Bible V6.5 Canon Sync Patch.
4. Story Bible V6.4.
5. Older handover notes and review drafts.

This prevents runtime design from reintroducing superseded Chapter 1 timing rules, the old Chapter 2 one-way-glass/work-order interpretation, premature `ZW_A16.lock` decoding, or conflicting chapter duration targets.

## 2. Summary

Lyra already supports a strong baseline loop:

1. read linear dialogue,
2. inspect investigation hotspots and interview characters,
3. collect evidence and statements,
4. challenge a testimony line, and
5. present one evidence item or statement as the contradiction.

The story requires one missing middle step: the player must organize several individually truthful fragments into an explicit inference before using that inference in a hearing.

This design adds that middle layer without replacing investigation or interrogation. The central addition is a fourth compiler-driven scene type, `analysis`, backed by Rust-owned deterministic state and reusable board templates. Analysis scenes let the player classify, order, compare, route, and connect records into authored facts.

The program also adds the product foundations required by multi-hour chapters:

- versioned save/load, autosave, and Continue,
- first-class facts, questions, objectives, and named procedure authorizations,
- shared case-record provenance and proof-capability metadata,
- a case file that separates records from established conclusions,
- contextual wrong-answer feedback and progressive hints,
- investigation-time evidence and statement use,
- staged investigation maps, and
- a static frame-strip/timecode viewer for Chapter 2 and later media-heavy cases.

The result is one reusable detective grammar rather than a bespoke minigame for every chapter.

## 3. Narrative drivers

The story’s recurring rule is:

> Evidence fragments may be individually true while the story assembled from them is false.

The system must support these player actions:

- group records by the claim they can support,
- distinguish independent sources from repeated observations of one source,
- place events in a defensible order,
- compare raw, synchronized, summarized, composite, physical, testimonial, and subjective representations,
- build routes through authored locations and access gates,
- connect multiple contributors in a responsibility chain,
- prepare a justified procedural request from independent contradictions,
- receive an institutional authorization only when the appropriate authority grants it, and
- carry unresolved questions and cross-chapter anomalies without marking them as spoilers.

## 4. Goals

- Make the player perform the key inference instead of watching the detective explain it.
- Preserve one canonical truth and deterministic outcomes while allowing flexible investigation order.
- Support the eight-chapter evidence themes with a small set of reusable, compiler-validated templates.
- Keep Rust authoritative for rules, accepted solutions, durable state, transactions, and save snapshots.
- Keep authored story content in Markdown and semantic IDs rather than frontend-only rules or filesystem paths.
- Preserve the current `linear`, `investigation`, and `interrogation` contracts for content that does not opt into new features.
- Make source, procedural status, and proof limits understandable without turning dialogue into a terminology lecture.
- Make Chapters 1 and 2 the validation slices before expanding to later chapters.
- Support keyboard, assistive technology, reduced motion, and non-pointer alternatives for every analysis interaction.
- Make a three-to-four-hour chapter safe to leave and resume, including an incomplete analysis board.

## 5. Non-goals

- A free-form corkboard or unrestricted evidence graph.
- Natural-language or LLM-evaluated theory submission.
- Multiple truths, alternate canonical culprits, or branching culprit identities.
- Traditional health points, trial lives, consumable objections, or irreversible failure states.
- Real-time countdown puzzles or quick-time events.
- A large open world or second navigation engine.
- Full video decoding, editing, or arbitrary frame-accurate seek in the first release.
- Replacing authored testimony cross-examination with analysis boards.
- Custom Svelte correctness logic for a single chapter.
- Generic mutable string flags.
- Generic negative unlock predicates that can re-lock content.

## 6. Program shape

The program is delivered in five stages:

1. **Persistence and story state** — saves, facts, questions, objectives, authorizations, provenance, and monotonic unlock/reveal extensions.
2. **Analysis Scene MVP** — compiler contract, Rust runtime, Svelte workbench, and `classify`, `order`, and `threshold`.
3. **Chapter 1 vertical slice** — Beat 8.5 boards prepare a narrow-extraction request; the hearing grants the actual authorization.
4. **Chapter 2 expansion** — `compare`, `route`, staged city-map navigation, frame-strip/timecode media, investigation-time record use, and a control-room reaction `order` board.
5. **Later-chapter platform** — `chain`, richer archive views, authoring/editor support, and migration hardening.

No stage should bundle the entire program into one implementation branch. Each stage must leave the game buildable, testable, and playable.

## 7. Architectural invariants

### 7.1 One-directional content flow

```text
Authored Markdown
    ↓
compile-scenes
    ↓
validated global story catalog + validated scene JSON
    ↓
Rust GameEngine
    ↓
public GameStateView
    ↓
Svelte presentation and semantic input
```

- Markdown is parsed only at build time.
- Generated resources are never hand-edited.
- Rust never parses authored Markdown.
- Svelte never contains accepted solutions or answer keys.
- The frontend may own transient drag animation and focus state, but not durable board state.

### 7.2 Monotonic progression

Ordinary authored progression is monotonic:

> Once content becomes visible or unlocked, a later positive story-state mutation cannot hide or re-lock it.

The unlock language therefore does **not** include generic `not`.

This invariant keeps runtime behavior replay-safe and permits compiler reachability analysis through a positive fixed point.

### 7.3 Definitions are not mutable state

Authored labels, descriptions, accepted solutions, and dependencies are immutable compiled definitions. Saves contain mutable state and stable references, not copied authored definitions.

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

The exact file may be `story-catalog.json` or an equivalent section of the generated chapter index. The focused compiler spec locks the physical format; this umbrella design locks the ownership and availability requirement.

On load, Rust loads the catalog and current authored scene definitions, then applies the mutable snapshot.

## 8. ID namespace contract

| ID type | Scope |
|---|---|
| Evidence | Game-global |
| Statement | Game-global |
| Fact | Game-global |
| Question | Game-global |
| Objective | Game-global; chapter-specific IDs should be chapter-qualified by naming convention |
| Authorization | Game-global |
| Chapter | Game-global |
| Scene | Unique within a chapter; durable references use chapter ID + scene ID |
| Analysis board | Scene-local |
| Card/group/slot | Board-local or scene-local as declared by the focused schema |
| Hotspot/topic/sublocation | Investigation-scene-local |
| Map node | Investigation-scene-local |

A durable reference to a local board is qualified:

```ts
type AnalysisBoardRef = {
  chapterId: string;
  sceneId: string;
  boardId: string;
};
```

`analysis_completed` must distinguish board completion from scene completion through separate predicates or a qualified target kind; it must not accept an ambiguous unqualified ID.

## 9. Shared case-record provenance

Evidence and statements share one provenance concept. The public type is `CaseRecordProvenance`, not `EvidenceProvenance`.

The dimensions are orthogonal:

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

### 9.1 Neutral legacy behavior

Legacy records receive unspecified/empty defaults and remain visually unchanged.

An unspecified procedural status is **not** treated as an exhibit for rules that explicitly require an exhibit. A board that depends on status, source independence, completeness, or proof capability must require explicit metadata; missing required metadata is a compiler error, not a warning.

### 9.2 Immutable record chain

Lead → reacquired → exhibit is modeled as a chain of records, not an in-place mutation that erases provenance.

Example:

```text
anonymous_social_clip_lead
    ↓ superseded by
verified_original_clip
    ↓ superseded by
hearing_exhibit_clip
```

The earlier record remains inspectable. The later record carries its own acquisition/procedure origin and points to the record it supersedes.

This supports Chapter 1’s phone screenshot → forensic fixed page, Chapter 2’s online clip → verified original, and Chapter 8’s lead → reacquired → exhibit process.

## 10. Story-state definitions and state

### 10.1 Facts

A fact is a durable proposition that the player has established. It is not a physical item and cannot be presented as a photograph.

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

The engine can calculate the transitive supporting record closure of a fact.

For the MVP, a threshold board that enforces independent sources may select only evidence and statement cards. Fact and free case-note cards are not eligible for source-count thresholds until transitive-lineage evaluation has focused tests.

### 10.2 Questions

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

Questions use neutral wording. A cross-chapter question is never labeled “main story clue” in the player UI.

Resolution is deterministic when all required facts are asserted, unless the definition explicitly uses an authored hearing ruling as the resolution event.

### 10.3 Objectives

The system supports exactly one primary active objective. Optional secondary objectives may exist, but Continue and HUD summaries always use the primary objective.

```ts
type ObjectiveDefinition = {
  id: string;
  label: string;
  summary: string;
  kind: "primary" | "secondary";
};

type ObjectiveState = {
  id: string;
  revealed: boolean;
  status: "inactive" | "active" | "completed";
  sortOrder: number;
};
```

Compiler validation rejects reachable states with more than one active primary objective.

### 10.4 Procedure authorizations

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

An internal detective workbench can establish that a request is justified, but it cannot grant a court, review-board, police, vendor, or building authorization unless that authority is represented by the authored resolution event.

Chapter 1 therefore separates:

- **request readiness:** established in Beat 8.5 analysis; and
- **`narrow_lock_export`:** granted by the review hearing after the request is argued.

Wrong submissions never permanently consume the opportunity to request or receive an authorization.

## 11. Fourth scene type: `analysis`

### 11.1 Scene contract

The compiler adds `analysis` to the chapter scene union and recognizes `analysis_scene_<K>.md`.

An analysis scene contains:

- scene identity and title,
- intro dialogue,
- one or more ordered board definitions,
- card sources and case-note definitions,
- feedback and hint definitions,
- success reveals,
- outro dialogue and completion condition,
- semantic asset/audio references.

Game-global fact/question/objective/authorization definitions live in the global story catalog. An analysis scene references them; it does not become their only definition store.

Boards are a tagged union. A generic untyped `config` object is not permitted.

### 11.2 Board availability and navigation

```ts
type AnalysisBoardBase = {
  id: string;
  label: string;
  prompt: string;
  required: boolean;
  unlock: StoryUnlockExpr | null;
  cards: AnalysisCardDefinition[];
  reveals: AnalysisRevealTarget[];
  onCorrect: DialogueItem[];
  feedbackRules: AnalysisFeedbackRule[];
  hints: AnalysisHint[];
};
```

Rust exposes:

- all currently available boards,
- `activeBoardId`,
- completion state,
- the durable draft for each board,
- revealed hints and latest feedback.

Rules:

- The engine may auto-focus the first newly available incomplete required board.
- The player may explicitly select any available board.
- `required` affects scene completion, not whether an available board may be opened.
- Completed boards can be revisited in read-only review mode.
- Optional boards can strengthen corroboration, dialogue, or context but cannot be the only source of a mandatory fact.
- Chapter 1 may author a sequential board order without hard-coding global runtime linearity.

### 11.3 Card sources

```ts
type AnalysisCardSource =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "caseNote"; id: string; label: string; summary: string };
```

The accepted solution is present only in compiled Rust resources. Public views contain candidates, groups/slots/nodes, drafts, completion, visible hints, and feedback—never accepted mappings, orders, or paths.

## 12. Analysis templates

### 12.1 MVP templates

#### `classify`

The player assigns every required card to one authored group. The MVP supports one accepted group per required card.

#### `order`

The player places every required card in one canonical total order. Fixed anchor cards may be displayed but not moved.

#### `threshold`

The player selects a minimum number of eligible evidence/statement cards while satisfying authored requirements:

- minimum selected count,
- minimum distinct `sourceGroupId` count,
- required proof capabilities,
- allowed or prohibited procedural statuses,
- optional explicit eligible-card set.

A source-independent threshold cannot be satisfied by two records derived from one source group.

### 12.2 Expansion templates

#### `compare`

The player aligns records across two or more authored columns/layers. It supports Chapter 2 wall/composite/direct-observation comparison and Chapter 6 raw/sync/summary comparison.

#### `route`

The player selects and orders declared nodes/edges through an authored graph. It supports multiple authored valid paths and explicit outbound/return routes. It is not arbitrary pathfinding or freehand drawing.

#### `chain`

The player connects declared cause, intervention, omission, and consequence nodes using accepted directed edge sets. It supports multiple contributors and does not force a false single-culprit model.

## 13. Analysis runtime and transaction flow

1. Entering an analysis scene plays its intro through a stable authored queue origin.
2. Rust exposes available boards and chooses/retains `activeBoardId`.
3. A completed card move, placement, selection, connection, or reorder sends the complete typed draft to Rust.
4. Rust validates draft shape and stores the last valid draft durably.
5. Submit evaluates the stored draft.
6. A wrong but well-formed submission returns gameplay feedback, increments the failure count, and preserves the draft.
7. A malformed draft returns a typed application error and preserves the prior valid draft.
8. A correct submission atomically commits:
   - accepted player draft,
   - board completion,
   - fact/question/objective mutations,
   - request-readiness or authorization state when appropriate,
   - inventory/provenance reveals,
   - durable acquisition events,
   - installation of the stable `onCorrect` dialogue queue.
9. If any required reveal fails, none of the durable changes survive.
10. Repeated correct submissions cannot replay durable reveals or acquisition events.
11. After all required boards and the outro condition are complete, the scene advances.

The durable resolution is committed before `onCorrect` is displayed. The queue origin/cursor is saved so resume cannot repeat the reveal or skip the dialogue.

## 14. Reveal and unlock language

Existing positive predicates remain valid. The shared language adds:

- `fact_asserted`,
- `question_resolved`,
- `objective_completed`,
- `analysis_board_completed`,
- `analysis_scene_completed`,
- `authorization_granted`, and
- `at_least(count, conditions[])` over a non-empty list.

Existing `and` and `or` remain supported.

There is no generic `not` predicate.

The reveal union adds:

- reveal/open question,
- assert fact,
- activate/complete objective,
- mark request readiness where modeled as a fact/objective,
- grant authorization from an authored authority event,
- reveal evidence/statement/case record,
- unlock later boards/scenes through positive state.

All reveal transactions are atomic and idempotent.

## 15. Compiler reachability analysis

The compiler performs positive fixed-point reachability:

1. Seed initially unlocked chapters/scenes/boards/sublocations/cards/records.
2. Apply every reveal reachable from those states.
3. Re-evaluate `and`, `or`, and `at_least` expressions.
4. Repeat until no new state becomes reachable.
5. Error on unreachable mandatory content or grants required by mandatory content.
6. Warn on unreachable optional content.

Compiler validation also rejects:

- unresolved or duplicate IDs according to the namespace table,
- self-reference and positive unlock cycles,
- invalid `at_least` counts,
- required cards that can never become visible,
- facts declared but never assertable,
- authorizations required with no reachable authority grant,
- more than one reachable active primary objective,
- incomplete `classify` and `order` solutions,
- unsatisfiable threshold requirements,
- provenance-dependent boards whose referenced records lack required metadata,
- invalid route nodes/edges,
- invalid media time mappings, and
- feedback or hint references that do not resolve.

Diagnostics include source file and line information.

## 16. Save, load, autosave, and Continue

### 16.1 User-facing behavior

Lyra provides:

- one rolling autosave,
- one previous-autosave backup,
- three manual slots,
- Continue loading the newest valid save,
- slot metadata showing chapter, scene, primary objective, save type, and update time,
- overwrite confirmation for occupied manual slots,
- clear corrupt/incompatible diagnostics without deleting the file.

Manual saving is allowed only after a command has committed and no mutation is in flight. Dialogue, investigation, interrogation, and analysis may all be saved when their current state is reconstructable under the queue/event contract below.

### 16.2 Stable queue origins and durable events

The save system does not copy arbitrary authored dialogue text into the snapshot and does not rely on frontend-only pending queues.

Every active dialogue queue has a stable origin, for example:

```ts
type DialogueQueueOrigin =
  | { kind: "linearScene"; chapterId: string; sceneId: string }
  | { kind: "investigationIntro"; chapterId: string; sceneId: string }
  | { kind: "investigationInteraction"; chapterId: string; sceneId: string; interactionId: string }
  | { kind: "interrogationPhase"; chapterId: string; sceneId: string; phaseId: string; segmentId: string }
  | { kind: "analysisIntro"; chapterId: string; sceneId: string }
  | { kind: "analysisResult"; chapterId: string; sceneId: string; boardId: string }
  | { kind: "storyEvent"; chapterId: string; sceneId: string; eventId: string };
```

The snapshot stores the queue origin, queue-definition hash, and cursor. Rust reconstructs the authored queue from packaged definitions.

Acquisition acknowledgement is also durable. A successful transaction creates ordered acquisition events owned by Rust:

```ts
type AcquisitionEventState = {
  id: string;
  recordKind: "evidence" | "statement";
  recordId: string;
  createdByCommandId: string;
  acknowledged: boolean;
};
```

The frontend displays unacknowledged events after their authored dialogue drains and acknowledges them through a command. Saving during acquisition dialogue therefore preserves the eventual popup instead of losing a module-local buffer.

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
  snapshot: GameSnapshot;
};
```

The snapshot stores stable IDs and mutable state, including:

- current chapter and scene,
- current scene runtime state,
- active dialogue origin/hash/cursor,
- inventory record IDs and acquisition metadata,
- unacknowledged acquisition events,
- facts/questions/objectives/authorizations,
- investigation progress,
- interrogation progress,
- analysis board drafts/completion/failures/hints,
- dialogue-history state needed for exact resume,
- monotonic generation counters needed to reject stale actions.

### 16.4 Autosave policy

A debounced autosave runs after successful commands that change durable state. It executes after the state transaction commits and never during an in-flight mutation.

The writer:

1. writes a temporary file,
2. flushes and fsyncs where supported,
3. rotates the current autosave to the previous-autosave backup,
4. atomically replaces the current autosave.

Autosave failure surfaces a persistent non-blocking warning and preserves the previous valid file.

### 16.5 Compatibility policy

ID existence alone is not sufficient for compatibility.

- `schemaVersion` controls explicit data migrations.
- `contentRevision` identifies the compiled story bundle.
- Active/incomplete scene, board, and dialogue definitions carry definition hashes.
- An active/incomplete object requires an exact hash match or an explicit migration.
- Completed historical boards may be grandfathered across a definition change only through an explicit migration that preserves their durable outputs.
- Optional completed state may be dropped only when compiled dependency analysis proves that no surviving fact, objective, authorization, unlock, or current state depends on it.
- A missing current chapter, scene, required board, queue origin, inventory definition, or required story definition rejects the load transactionally.
- A corrupt primary autosave may fall back to the previous-autosave backup.
- Incompatible/corrupt files are preserved until the player deliberately replaces or deletes them.

Audio preferences remain separate user settings.

## 17. Case file, objective, and recap

The current inventory view evolves into an MVP case file with:

1. **Current Objective** — one primary objective plus optional secondary objectives.
2. **Evidence** — details, provenance, procedure, confidence, source group, and proof capabilities.
3. **Statements** — statement copy and provenance where authored.
4. **Established Facts** — conclusions personally established by the player.
5. **Open Questions** — neutral open/resolved problems.
6. **Authorizations** — granted institutional permissions and their meaning.

Rules:

- Existing evidence/statement re-examination remains available in valid modes.
- Facts cannot be selected as physical evidence.
- Superseded leads remain inspectable and link to the later record.
- Locked definitions are not exposed.
- Cross-chapter questions are not visually marked as main-story clues.
- Save/Continue summaries use authored chapter/scene copy and the primary active objective; no LLM recap is required.

People, locations, full chronology, and social-response archives remain P4 work.

## 18. Investigation-time record interactions

Investigation gains one generic action: present or use a collected evidence item or statement on an authored target.

Supported targets:

- character,
- topic,
- hotspot,
- sublocation interaction point.

An authored interaction declares:

- accepted record IDs or capability/status requirements,
- correct dialogue,
- exact-record wrong dialogue,
- proof-capability mismatch feedback,
- procedure-status mismatch feedback,
- default wrong dialogue,
- atomic reveals.

Only authored targets expose the action. Wrong use never consumes a record or mutates story state.

## 19. Procedure gates

Procedure is represented by named authorizations and reasoned request preparation, not by a score.

A typical sequence is:

1. investigation finds contradictions,
2. analysis establishes facts and completes a “prepare request” objective,
3. a hearing presents those facts,
4. the authority grants a named authorization,
5. the authorization unlocks limited evidence access or a later phase.

Examples:

- Chapter 1: prepare narrow lock request → review hearing grants `narrow_lock_export`.
- Chapter 6: establish a three-source contradiction → hearing grants `limited_raw_export`, then later `batch_raw_export`.
- Chapter 8: reacquire identity/provenance package → judge grants witness standing or exhibit admissibility.

A wrong request receives a reasoned denial and remains retryable.

## 20. Feedback and hints

Feedback precedence:

1. exact record or combination,
2. prohibited procedural status,
3. duplicate source group,
4. missing proof capability,
5. structural incompleteness,
6. default feedback.

Examples:

- “This establishes time, not identity.”
- “Both clips derive from the broadcast wall; they are not independent observations.”
- “This source is still a lead and has not been reacquired.”
- “The route reaches the empty floor but does not explain the return path.”

Boards may define four deliberate hint levels:

1. restate the question,
2. identify the relevant evidence package/source layer,
3. identify the missing capability or independence rule,
4. name the specific next record set/connection.

Hints never mutate durable facts, solve a board, or consume a resource.

## 21. Media and map support

### 21.1 Static frame-strip viewer

The first media feature uses authored still frames, not a video pipeline.

A frame set may define:

- ordered image assets,
- absolute timestamps,
- an optional relative time axis such as Chapter 2 `S+`,
- source/viewpoint label,
- provenance/source group,
- short annotations,
- optional authored overlays.

Absolute time and `S+` are displayed simultaneously when needed. `S+00m45s` must never be rendered or parsed as `00:45 a.m.`.

The viewer is an evidence-detail surface and `compare` card source, not a video editor.

### 21.2 Staged investigation map

Map metadata contains only:

- normalized node position,
- mapped sublocation ID,
- cluster/stage,
- optional edges,
- display label/icon.

Visible, locked, current, and completed states are derived from the mapped investigation sublocation and existing progression state. They are not separately authored or persisted.

The map selects the same `currentSublocationId` used by ordinary investigation navigation. It never creates a second navigation state.

## 22. Chapter 1 vertical slice

Chapter 1 uses one playable analysis scene at Beat 8.5:

```text
analysis_scene_8_5.md
```

The current Beat 8.5 transition dialogue moves into its intro/outro. The playable manifest does not retain both the old linear scene and the analysis scene.

### 22.1 Required boards

1. **Evidence packages (`classify`)**
   - Miyake’s known small lies unrelated to murder.
   - Earlier third-party contractor route.
   - Lock chronology.

2. **Local event sequence (`order`)**
   - `Event-1841` through `Event-1844`.
   - Establish that local order is not an exact event timestamp.

3. **Narrow-request basis (`threshold`)**
   - Select at least two independent contradictions directly challenging lock chronology.
   - Same-source records fail.

### 22.2 Beat 8.5 outputs

Facts:

- `miyake_known_lies_are_unrelated_to_murder`
- `earlier_external_entry_exists`
- `merge_time_is_not_event_time`
- `two_independent_lock_contradictions_identified`

Objective transition:

- complete `prepare_narrow_lock_request`

Beat 8.5 does **not** grant `narrow_lock_export`.

### 22.3 Hearing handoff

The final hearing consumes the facts and completed request-preparation objective. After the authority accepts the argument, the hearing grants:

- `narrow_lock_export`

The hearing then reveals the limited extract and continues the existing proof order. This preserves the fiction that the detective prepares the request and the institution grants access.

Chapter 1 is the acceptance gate for:

- persistence,
- stable dialogue/acquisition resume,
- story state and catalog,
- provenance,
- monotonic unlock/reveal targets,
- analysis compilation/runtime/UI,
- all three MVP templates,
- case-file integration,
- feedback/hints,
- request/authorization separation,
- accessibility,
- packaged Tauri end-to-end flow.

## 23. Chapter 2 expansion

Chapter 2 validates flexible investigation order and richer source reasoning.

The map uses Phase A/B/C and keeps the golden path within 7–8 mandatory locations. Optional side stories strengthen corroboration, dialogue, or context but are never the only source of a required fact.

### 23.1 Required boards

1. **Sightline (`classify`)**
   - box,
   - broadcast wall,
   - Program Composite,
   - side/direct view.

2. **Image source (`compare`)**
   - broadcast wall,
   - fan phone,
   - Program Composite,
   - low-frame QA records.

3. **Control-room reaction (`order`)**
   - director identifies apparent projection/sync fault,
   - AD calls back standby,
   - Hasumi answers for Mashiro,
   - PR opens the technical-incident template,
   - security leaves M-03/service lift unsealed while the request remains valid.

   This is an ordered response reconstruction using the MVP `order` grammar. It does not wait for the later causal `chain` template.

4. **Route (`route`)**
   - outbound safety-position → sponsor corridor → M-03 → service lift B → vacant floor,
   - separate return route through stairs/rear exit,
   - expired sponsor pass cannot be reused for return.

5. **Person/capability (`classify` or authored threshold composition)**
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

The final culprit conclusion is established only after route, access, first-response control, and motive are all available. A single broad fact must not hide those separate proof functions.

### 23.3 Chapter 2 constraints

- Wall-derived fan clips share one source group.
- QA frames prove movement/route, not identity.
- The fifteen-minute pass proves the outbound route, not the return route.
- `S+` is an offset from the midnight sponsor block, not a clock time.
- Amemiya’s “Don’t look at the wall” is one route, not the unique mandatory path.
- Online material starts as a lead and must be reacquired/fixed before hearing use.
- Hasumi planned isolation/control; killing escalated after his control failed.
- No Chapter 2-specific evaluator logic exists outside authored data and reusable templates.

## 24. Frontend interaction and accessibility

- Every drag action has an equivalent select/move/confirm keyboard path.
- Cards, groups, slots, nodes, and connections expose semantic names and state.
- No result is communicated by color alone.
- Feedback/hints use live regions and return focus to the relevant control.
- Escape follows the existing one-layer-per-press coordinator.
- Modal case-file, hint, feedback, and save surfaces manage focus and inertness correctly.
- `prefers-reduced-motion` removes card-flight, line-draw, and result animation.
- Analysis submissions cannot fire from accidental background clicks.
- Required controls remain visible at 1280×720.
- Source tests pin that Svelte contains no accepted solution or correctness branch.

## 25. Failure handling

- Invalid draft shape returns a typed error and preserves the last valid durable draft.
- Wrong well-formed submission is gameplay feedback, not an application error.
- Stale actions are rejected through board/view generation tokens.
- Every gameplay command that may apply multiple reveals is transactional.
- Save failure preserves the last valid save.
- Load failure never partially mutates the active engine.
- Missing optional media assets use existing placeholders and do not block logic.
- Missing required authored cards, definitions, maps, routes, queues, or solutions are compile-time errors.
- Debug scene navigation may grant prerequisites only in debug builds and must create valid story-state/acquisition state rather than bypassing invariants.

## 26. Testing strategy

### Compiler

- global catalog definition and ID tests,
- parser/emitter fixtures for every template,
- invalid fixtures for missing IDs, impossible thresholds, cycles, duplicate cards, bad routes, bad time maps, ambiguous local references, and missing provenance,
- positive fixed-point reachability tests,
- Rust serde compatibility snapshots.

### Rust

- story-state reveal/unlock tests,
- provenance and support-lineage tests,
- typed draft mutation and stale-token tests,
- correct/wrong evaluation for every implemented template,
- source-group independence tests,
- request-readiness versus authority-grant tests,
- atomic resolution and exactly-once acquisition-event tests,
- save/load round trips for every scene runtime,
- mid-dialogue queue reconstruction,
- pending acquisition acknowledgement resume,
- definition-hash incompatibility and explicit migration tests,
- investigation record-interaction tests,
- full Chapter 1 playthrough.

### Frontend

- case-file sections and neutral legacy rendering,
- keyboard/pointer parity,
- focus/Escape/inert behavior,
- feedback and hint announcements,
- acquisition-event acknowledgement after save/resume,
- save-slot and Continue behavior,
- dual-time display,
- map-derived state and navigation,
- reduced motion.

### End to end

The packaged Tauri app must prove:

- new game through Chapter 1 analysis and final hearing,
- save during every incomplete Chapter 1 board and restore exact drafts,
- save during authored result/acquisition dialogue and restore the pending acknowledgement,
- wrong same-source threshold feedback,
- request readiness established in analysis,
- `narrow_lock_export` granted only in the hearing,
- return to title and Continue,
- manual overwrite confirmation,
- Chapter 2 staged-map and five-board golden path when P3 is implemented.

## 27. Rollout and compatibility

- Save/load may ship before authored analysis content.
- The global catalog and new state collections default empty for legacy content.
- `analysis` enters Chapter 1 only when P0/P1 contracts are stable.
- Legacy records remain usable and visually unchanged but cannot satisfy metadata-dependent rules without explicit metadata.
- Existing investigation/interrogation Markdown remains valid.
- Layout-editor support begins read-only.
- Every new template requires compiler fixtures, Rust tests, frontend tests, and one authored acceptance board before later chapters use it.
- Chapter 2 implementation remains blocked until the complete Chapter 1 acceptance gate passes.

## 28. Alternatives not chosen

### One bespoke minigame per chapter

Rejected because it duplicates state, validation, accessibility, save, authoring, and test logic.

### Frontend-only analysis

Rejected because it exposes answer keys, complicates persistence, and violates Rust ownership.

### Free-form deduction graph

Rejected because it is difficult to author, validate, hint, save, test, and make accessible.

### Generic negation in unlocks

Rejected because it permits re-locking and makes reachability/order semantics unstable. Positive monotonic predicates and `at_least` cover the planned chapters.

### Numeric credibility or hearing health

Rejected because punishment does not model the story’s procedural stakes. Named authorizations and reasoned denials do.

### Full video pipeline first

Deferred because frame strips and dual time axes prove the gameplay requirement with much less packaging and test risk.

### Serialize full authored dialogue into saves

Rejected because it bloats and semantically freezes copied story text. Stable queue origins, definition hashes, and durable acquisition events preserve exact resume while keeping definitions in compiled resources.

## 29. Program acceptance criteria

The program-level design is satisfied when:

- PR #23/HPA-254 are the single canonical program track,
- the game saves and resumes every durable scene state and required pending acknowledgement,
- definitions and mutable state are cleanly separated through a global catalog,
- facts, questions, objectives, authorizations, and provenance are first-class runtime data,
- progression remains monotonic and compiler-reachable,
- an authored `analysis` scene compiles and runs without frontend answer keys,
- Chapter 1’s boards prepare a request while the hearing grants the authorization,
- the case file separates evidence, statements, facts, questions, objectives, and authorizations,
- wrong submissions explain proof limits and never make the case unwinnable,
- Chapter 2 distinguishes shared sources, reconstructs the control-room reaction, compares media layers, and proves separate outbound/return routes,
- investigation can use records on authored targets,
- all new behavior is compiler-, Rust-, frontend-, accessibility-, save-, and Tauri-e2e tested,
- later chapters can add `compare`, `route`, or `chain` without a bespoke runtime mode.

## 30. Required focused specifications

Before implementation, approve focused specs and executable plans for:

1. Global story catalog, state, provenance, support lineage, and monotonic unlock/reveal contract.
2. Save snapshot, stable queue origins, durable acquisition events, definition hashes, and compatibility/migration policy.
3. Analysis-scene Markdown/compiler contract and fixed-point reachability.
4. Rust analysis runtime, transactions, public views, and generation-token contract.
5. Analysis workbench interaction and accessibility.
6. Chapter 1 Beat 8.5 analysis and hearing handoff.
7. Investigation-time record interaction.
8. Chapter 2 map/media/compare/route/control-room expansion.

This umbrella document defines shared invariants. It does not authorize one all-at-once implementation branch.