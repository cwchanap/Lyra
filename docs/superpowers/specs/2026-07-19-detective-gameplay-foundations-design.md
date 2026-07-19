# Detective Gameplay Foundations Design

**Date:** 2026-07-19  
**Status:** Proposed for review  
**Repository:** `cwchanap/Lyra`  
**Related narrative references:** `docs/stories_plan/tokyo_rain_witness_final_story_bible_v64.md`, the Chapter 1 V3.7 writing plan, and the Chapter 2 V0.7 timecode/control-room plan

## Goal

Evolve Lyra from a strong investigation-and-cross-examination framework into a complete detective reasoning game in which the player must organize evidence, distinguish evidence sources, form explicit conclusions, and earn procedural access before presenting a case.

The target player loop is:

> Investigate → analyze → assert a fact → use that fact in a review hearing.

The design must support the central theme of *Tokyo Rain Testimony*: individual records can be true while the story created by their ordering is false.

## Problem statement

Lyra already supports three scene types:

- `linear`: read authored dialogue;
- `investigation`: inspect hotspots, interview characters, collect evidence and statements;
- `interrogation`: ask questions, challenge testimony lines, and present one evidence or statement item against one contradiction.

That loop is sufficient for a simple Ace Attorney-style case, but the planned story repeatedly asks the player to prove conclusions that do not exist as a single evidence item:

- several true records were merged into the wrong timeline;
- thousands of apparent witnesses share the same observation source;
- an access log proves a route but not an identity;
- a source is a lead, then legally re-acquired, then admitted as an exhibit;
- two people independently caused one death;
- true memory fragments were placed in the wrong order;
- the player must establish a procedural threshold before raw data can be requested.

Today, these conclusions must be spoken by the protagonist or simulated as a sequence of single-item presentations. The missing layer is player-owned analysis.

## Product decision

Add a fourth compiler-driven scene type, `analysis`, and a small set of reusable deterministic analysis templates.

Do **not** build one custom minigame per chapter. Do **not** build a free-form evidence graph. Authors define cards, slots, validation rules, facts, questions, hints, and rewards in Markdown; the compiler validates them; Rust owns authoritative progress and validation; Svelte renders the interaction.

The system is intentionally fixed-structure and deterministic. It should feel like arranging a theory, not guessing what an AI parser considers correct.

## Scope

### In scope

1. A versioned save/load and autosave system suitable for 3–4 hour chapters.
2. Explicit game-global `Fact`, `Question`, and `AccessGrant` records.
3. Evidence provenance and procedural state metadata.
4. A new `analysis` scene type.
5. Reusable analysis templates:
   - first release: `classify`, `order`, and `threshold`;
   - later release: `compare`, `route`, and `chain`.
6. Monotonic unlock extensions for facts, completed analyses, access grants, and `at_least` conditions.
7. Presenting or using evidence during investigation scenes.
8. Context-aware wrong-answer feedback and progressive authored hints.
9. A Case Archive that exposes evidence provenance, established facts, open questions, access grants, and the current objective.
10. A static frame-strip media viewer for source/timecode comparison.
11. A Chapter 1 vertical slice centered on Beat 8.5.
12. A Chapter 2 vertical slice centered on the four evidence boards and the `S+` time model.

### Out of scope

- Free-form graph drawing or natural-language theory submission.
- AI-evaluated deductions.
- Branching truths or multiple canonical culprits.
- Relationship or affection systems.
- Real-time action sequences and punitive quick-time events.
- A traditional health bar for review hearings.
- Full video decoding, streaming, editing, or frame-accurate arbitrary seeking in the first media release.
- Custom Svelte game logic that bypasses the compiler and Rust engine for one chapter.
- Non-monotonic progression predicates that can re-lock previously visible content.

## Current architecture constraints

The design preserves the existing one-directional ownership model:

```text
Authored Markdown
    ↓
packages/scripts/compile-scenes
    ↓
validated scene JSON in Tauri resources
    ↓
Rust GameEngine (authoritative state and rules)
    ↓
Svelte presentation and input
```

Key constraints:

- SvelteKit remains a static SPA inside Tauri; no SSR or server routes.
- Rust remains the sole owner of gameplay truth.
- Markdown is parsed only at build time.
- Existing `linear`, `investigation`, and `interrogation` content must continue to compile without migration edits.
- Game-global IDs are required for evidence, statements, facts, questions, and access grants because later chapters may refer back to them.
- Scene-local IDs remain appropriate for hotspots, topics, phases, cards, slots, and analysis boards.
- Unlocks remain monotonic. The system does not add a generic `not` predicate.

## Design principles

### 1. Facts are conclusions, not renamed evidence

A `Fact` records something the player has demonstrated by combining evidence or testimony. Examples:

- `merge_time_is_not_event_time`;
- `miyake_could_not_see_the_body`;
- `crowd_observed_the_wall`;
- `control_room_relied_on_hasumi`;
- `incident_view_compressed_dates`.

A fact may unlock questions, locations, interrogation phases, access grants, or later analyses. It is not displayed as a physical item and cannot be presented as though it were a photograph.

### 2. Evidence states describe what an item can legally and logically prove

The evidence dossier must distinguish at least three independent dimensions:

- how the player discovered the item;
- what data or observation layer it belongs to;
- what procedural state it has reached.

An anonymous clip can be useful as a lead without being admissible. A local maintenance screenshot can expose a contradiction without being the exhibit used in the hearing.

### 3. Analysis feedback is structural

Wrong answers should explain the type of gap:

- the card is in the wrong category;
- two selected records are duplicates of one source group;
- the evidence establishes time but not identity;
- the source is still only a lead;
- the order is inconsistent with a locked physical anchor;
- the player has not met the required independent-source threshold.

The default response is not merely “wrong evidence.”

### 4. Submission is holistic

The board does not reveal correctness after every drag. The player arranges a complete theory and submits it. Rust returns overall and per-part feedback. This preserves deduction rather than turning the interaction into a slot-by-slot matching quiz.

### 5. Alternative investigation routes converge on one fair conclusion

Different locations or optional witnesses may establish the same fact, but no optional branch may be the only source of a mandatory proof. Alternative paths should affect corroboration, hints, dialogue, or procedural confidence, not canonical truth.

### 6. Procedure replaces punishment

Review-hearing failure should not be modeled primarily as lost health. The meaningful stakes are access and credibility:

- a request remains locked;
- a source is challenged as inadmissible;
- the player must establish another fact;
- a hearing phase rejects an overclaim;
- a narrower extraction is granted before a broader export.

## Player-facing gameplay loop

### Investigation

The player inspects locations, interviews people, and acquires evidence or statements. Some interactions can now use an inventory item on a target.

### Analysis

The player enters a focused board with a specific question, such as:

- “Which observations are genuinely independent?”
- “What was the local event order?”
- “Which two contradictions justify a narrow extraction?”
- “Which route was available before the pass expired?”

The player arranges cards, submits the complete board, receives structured feedback, and revises if needed.

### Fact assertion

Successful analysis asserts one or more authored facts. A short authored resolution queue plays after the engine has accepted the board.

### Procedure and confrontation

Facts unlock hearing phases, evidence access grants, investigation locations, or new questions. The player then presents the case through the existing interrogation/review-hearing mechanics.

### Archive and resume

At any time allowed by the current mode, the player can review:

- evidence and statements;
- provenance and procedural state;
- established facts;
- open questions;
- granted access;
- the current objective;
- a concise resume summary after loading a save.

## Domain model

### Evidence provenance

The existing evidence definition is extended with optional metadata. Old content receives safe defaults.

```ts
type DiscoveryVisibility = "visible" | "implied" | "hidden";

type EvidenceLayer =
  | "physical"
  | "raw"
  | "sync"
  | "summary"
  | "subjective";

type ProceduralStatus = "lead" | "reacquired" | "exhibit";

type EvidenceConfidence =
  | "unverified"
  | "corroborated"
  | "disputed"
  | "superseded";

type ProofScope =
  | "time"
  | "route"
  | "identity"
  | "motive"
  | "capability"
  | "procedure"
  | "observation";

type EvidenceProvenance = {
  layer: EvidenceLayer;
  proceduralStatus: ProceduralStatus;
  confidence: EvidenceConfidence;
  sourceLabel: string;
  sourceGroup: string;
  proofScopes: ProofScope[];
  acquiredAtLabel?: string;
  supersedesEvidenceId?: string;
};
```

`sourceGroup` identifies observations that are not independent. For Chapter 2, many fan videos may share `sourceGroup: "shibuya_live_wall"` even though they are separate files.

`supersedesEvidenceId` allows the dossier to show that a formal exhibit replaced an earlier lead without duplicating the conceptual clue in the player's mental model.

### Facts

```ts
type FactDefinition = {
  id: string;
  name: string;
  summary: string;
  details: string;
  proofScopes: ProofScope[];
  sourceAnalysisSceneId: string;
  onAssert: DialogueItem[];
};

type FactRecord = FactDefinition & {
  assertedInChapterId: string;
  assertedInSceneId: string;
};
```

Rules:

- Fact IDs are game-global.
- A fact is asserted once and remains true for the rest of the playthrough.
- Re-entering a solved analysis scene does not replay acquisition side effects.
- Facts can be reviewed but are not treated as physical evidence.

### Questions

```ts
type QuestionDefinition = {
  id: string;
  prompt: string;
  context: string;
  resolvedByFactIds: string[];
};

type QuestionRecord = QuestionDefinition & {
  status: "open" | "resolved";
};
```

Questions give the Case Archive and analysis UI a player-readable objective. They are game-global and resolve automatically when all required facts have been asserted.

### Access grants

```ts
type AccessGrantDefinition = {
  id: string;
  name: string;
  description: string;
  onGrant: DialogueItem[];
};

type AccessGrantRecord = AccessGrantDefinition & {
  grantedInChapterId: string;
  grantedInSceneId: string;
};
```

Examples:

- `door_lock_metadata_access`;
- `narrow_door_lock_extraction`;
- `incident_view_limited_raw_export`;
- `incident_view_batch_raw_export`.

An access grant is a monotonic capability. It may reveal a sublocation, a new evidence version, an analysis scene, or a hearing phase.

### Reveal targets

The reveal union gains:

```ts
| { kind: "fact"; id: string }
| { kind: "question"; id: string }
| { kind: "accessGrant"; id: string }
| { kind: "analysis"; id: string }
```

Question reveals open the question; fact and access-grant reveals assert/grant only when authored by a successful resolution path. Analysis reveals make a later analysis scene available.

### Unlock expressions

The monotonic expression language gains:

```ts
| { predicate: "fact_asserted"; id: string }
| { predicate: "analysis_completed"; id: string }
| { predicate: "access_granted"; id: string }
| {
    op: "at_least";
    count: number;
    conditions: UnlockExpr[];
  }
```

Existing `and` and `or` remain supported.

`at_least` provides alternate-route progression without non-monotonic logic. Compiler validation requires `1 <= count <= conditions.length` and rejects empty lists.

## Analysis scene type

### File naming

```text
analysis_scene_<K>.md
```

The chapter manifest infers the `analysis` scene type from the filename prefix.

### Scene-level structure

An analysis scene contains:

- title and player-facing question;
- optional intro dialogue;
- one or more ordered boards;
- a fact, question, evidence, statement, access-grant, or later-board manifest;
- an authored hint ladder;
- success and retry dialogue;
- an outro unlock rule.

A scene may contain several small boards when they are one reasoning beat. It should not become a whole chapter-sized workbench.

### Common card model

```ts
type AnalysisCard = {
  id: string;
  label: string;
  description: string;
  source: InventoryTarget | { kind: "fact"; id: string };
  sourceGroup?: string;
  proofScopes?: ProofScope[];
  proceduralStatusRequirement?: ProceduralStatus;
};
```

Cards may reference already acquired evidence, statements, or facts. The engine exposes only cards whose source requirements are satisfied.

### Common board state

```ts
type AnalysisBoardState = {
  boardId: string;
  placements: Record<string, string[]>;
  selectedCardIds: string[];
  submitted: boolean;
  solved: boolean;
  failedAttempts: number;
  lastFeedback: AnalysisFeedback | null;
};
```

The exact placement semantics are template-specific, but Rust owns the state and validation.

### Feedback

```ts
type AnalysisFeedback = {
  result: "incomplete" | "incorrect" | "correct";
  summary: string;
  items: Array<{
    targetId: string;
    result: "correct" | "incorrect" | "missing" | "overclaim";
    reasonCode:
      | "wrongPlacement"
      | "duplicateSourceGroup"
      | "proofScopeMismatch"
      | "proceduralStatusInsufficient"
      | "orderingConflict"
      | "missingRequirement";
    message: string;
  }>;
  newlyAvailableHintIndex: number | null;
};
```

Authors provide concise messages for important expected mistakes. The engine can generate safe generic feedback from provenance metadata when no exact override is authored.

## Analysis templates

### Release 1: Classify

Purpose: group cards under authored categories.

Examples:

- Chapter 1 evidence packages: Miyake's small lies, earlier third-party route, door-lock timing.
- Chapter 2 observation sources: naked-eye observation, wall/composite observation, device/system trace.

Validation:

- each required card has one accepted bucket;
- optional cards may have several accepted buckets or be unused;
- the board can require all cards or only a minimum number;
- correctness is evaluated only on submission.

### Release 1: Order

Purpose: arrange events or records in sequence.

Examples:

- Chapter 1 local event sequence before server merge;
- Chapter 4 memory fragments;
- Chapter 5 production schedule actions.

Validation:

- strict ordered sequence by default;
- optional equivalence groups allow two cards to be interchangeable when the story does not distinguish their exact order;
- locked anchors can be pre-placed and cannot be moved;
- feedback identifies the first structural conflict without revealing the full solution.

### Release 1: Threshold

Purpose: select enough independent support to justify a conclusion or procedural request.

Examples:

- choose two independent contradictions to request narrow extraction;
- establish that multiple apparent witnesses share fewer independent sources;
- satisfy a hearing threshold without claiming identity from route-only evidence.

Validation can require:

- a minimum card count;
- a minimum number of distinct `sourceGroup` values;
- required proof scopes;
- a minimum procedural status;
- forbidden overclaims, such as using route evidence as identity evidence.

### Release 2: Compare

Purpose: compare several representations of the same event.

Examples:

- raw / sync / summary;
- live wall / fan phone / Program Composite / QA snapshot;
- official timeline / corrected timeline.

The player aligns source rows to common time or event columns and marks the field that changed meaning. This is not a spreadsheet editor; all rows and comparison targets are authored.

### Release 2: Route

Purpose: construct a valid path through an authored node graph.

Examples:

- Chapter 2 Glass Box → M-03 → Service Elevator B → vacant floor;
- Chapter 8 left-side escape route.

The player selects nodes and edges. The engine validates path continuity, access-grant requirements, time-window constraints, and authored mandatory nodes. Freehand drawing is not supported.

### Release 2: Chain

Purpose: arrange a causal or responsibility chain.

Examples:

- Chapter 2 control-room misclassification chain;
- Chapter 3 two independent harms causing one death;
- Chapter 7 exits being closed one by one.

The board uses fixed causal slots and optional branches. It is not a general graph editor.

## Investigation evidence interaction

### Player capability

During an investigation scene, the player may select an evidence or statement item and use it on:

- a hotspot;
- a visible character;
- an interview topic when authored;
- a sublocation-level context action.

### Authored interaction model

```ts
type InvestigationItemInteraction = {
  id: string;
  target:
    | { kind: "hotspot"; id: string }
    | { kind: "character"; id: string }
    | { kind: "topic"; characterId: string; topicId: string }
    | { kind: "sublocation"; id: string };
  item: InventoryTarget;
  once: boolean;
  dialogue: DialogueItem[];
  reveals: RevealTarget[];
};
```

A generic fallback response plays when no interaction exists. The frontend never infers whether an item is useful.

Example Chapter 2 interactions:

- show the filming-position map to a fan;
- use the fifteen-minute pass on the logistics map;
- compare the QA snapshot against the M-03 door trace;
- present the permission table to Saegusa.

## Context-aware presentation feedback

Interrogation testimony lines gain optional feedback overrides:

```ts
type WrongPresentationFeedback = {
  item?: InventoryTarget;
  proofScope?: ProofScope;
  proceduralStatus?: ProceduralStatus;
  dialogue: DialogueItem[];
};
```

Resolution order:

1. exact item override;
2. matching proof-scope override;
3. procedural-status override;
4. authored default wrong response;
5. engine fallback.

This allows the game to explain “this proves the route, not the person” without authoring a bespoke response for every inventory item.

## Hint system

Hints are authored, finite, and optional.

Each analysis scene defines a ladder such as:

1. restate the current question;
2. identify the relevant evidence package or source layer;
3. identify the required proof scope;
4. point to a specific card only as the final hint.

A hint becomes available after an authored number of failed submissions or through an explicit “Consult Akane” action. Hints do not auto-open and do not change the solution.

## Case Archive

The existing Evidence panel becomes one section of a wider archive.

### Sections

- **Objective** — current open question and the next authorized action.
- **Evidence** — physical and digital items with provenance badges.
- **Statements** — acquired testimony.
- **Facts** — established conclusions and their supporting analysis scene.
- **Questions** — open and resolved questions.
- **Access** — granted metadata, extraction, or review permissions.

Character and location records may be added later without changing these core sections.

### Provenance presentation

Each evidence record may display:

- layer: physical, raw, sync, summary, subjective;
- procedural status: lead, re-acquired, exhibit;
- confidence state;
- source label;
- proof-scope badges;
- whether a later record superseded it.

The UI must avoid unexplained technical jargon. Labels may use player-facing localized strings while retaining stable semantic IDs in data.

## Save/load and resume

### Save snapshot

The save payload serializes authoritative engine state, not Svelte component state.

```ts
type SaveEnvelope = {
  formatVersion: number;
  contentVersion: string;
  savedAt: string;
  slot: "autosave" | "manual-1" | "manual-2" | "manual-3";
  summary: SaveSummary;
  engine: GameSnapshot;
};
```

`GameSnapshot` includes:

- current chapter and scene;
- active scene runtime state;
- inventory;
- facts, questions, and access grants;
- analysis board state;
- dialogue history required for resume;
- queue generation/cursor state;
- any chapter-completion state.

### Autosave boundaries

Autosave after:

- starting a new scene after its initial queue has been safely installed;
- completing an analysis board;
- completing an interrogation phase;
- granting a procedural access level;
- completing a chapter.

Do not autosave in the middle of applying one command's reveals.

### Continue and load

The main menu enables:

- Continue from autosave;
- Load Game for three manual slots plus autosave;
- a concise summary: chapter, scene, objective, last save time.

### Compatibility

- `formatVersion` supports explicit save migrations.
- `contentVersion` is a deterministic fingerprint of compiled chapter manifests and scene IDs.
- A content mismatch produces a clear compatibility message; it must never silently reset progress.
- The first release may support only same-content-version loads, provided the error is explicit and saves remain intact.

## Static media frame-strip viewer

The first media feature is a deterministic frame set, not a full video player.

```ts
type MediaFrameSet = {
  id: string;
  title: string;
  sourceLabel: string;
  sourceGroup: string;
  frames: Array<{
    id: string;
    imageAssetId: string;
    absoluteTimeLabel?: string;
    relativeTimeLabel?: string;
    caption: string;
    overlayLabels: string[];
  }>;
};
```

Capabilities:

- step frame by frame;
- switch between authored source sets;
- show absolute time and relative `S+` time together;
- toggle authored overlay labels;
- send a selected frame as a card to an analysis board.

No arbitrary seeking, decoding, or editing is included.

## Map metadata for Chapter 2

Investigation sublocations gain optional map metadata:

```ts
type InvestigationMapNode = {
  sublocationId: string;
  x: number;
  y: number;
  cluster: string;
  connections: string[];
};
```

The Chapter 2 map uses three authored clusters:

- Phase A: public event area;
- Phase B: city observation area;
- Phase C: logistics route and character resolution.

The map is navigation and orientation, not an open-world simulation. Existing `SublocationNav` remains the fallback when map metadata is absent.

## Frontend architecture

### New components

- `AnalysisView.svelte` — template dispatcher and common board shell.
- `AnalysisCard.svelte` — common card rendering and selection.
- `ClassifyBoard.svelte`.
- `OrderBoard.svelte`.
- `ThresholdBoard.svelte`.
- `AnalysisFeedbackPanel.svelte`.
- `CaseArchive.svelte` and focused section components.
- `MediaFrameStrip.svelte`.
- `InvestigationMap.svelte`.

Release 2 adds focused `CompareBoard`, `RouteBoard`, and `ChainBoard` components rather than growing one monolithic file.

### Accessible interaction

Drag-and-drop may be offered visually, but it cannot be the only interaction.

Every board must support:

- keyboard selection of a card;
- keyboard selection of a slot/bucket;
- an explicit Place/Remove action;
- visible focus;
- screen-reader labels that include card, destination, and state;
- a non-motion path under `prefers-reduced-motion`.

## Engine architecture

The Rust engine gains:

- `SceneRuntime::Analysis`;
- game-global collections for facts, questions, and access grants;
- template-specific analysis state and validation modules;
- commands to place/remove/select/submit/reset an analysis board;
- investigation item-presentation commands;
- save/load commands;
- deterministic view models for the archive, analysis UI, media sets, and map.

`GameEngine` should delegate analysis, persistence, and provenance behavior to focused modules instead of adding all logic to `game/mod.rs`.

Recommended module boundaries:

```text
apps/game/src-tauri/src/game/
  analysis/
    mod.rs
    classify.rs
    order.rs
    threshold.rs
    feedback.rs
  persistence/
    mod.rs
    schema.rs
    storage.rs
  provenance.rs
  facts.rs
  access.rs
```

The existing scene loader, unlock evaluator, reveal application, view builder, and snapshot/restore paths must be extended through explicit interfaces.

## Compiler and authoring architecture

Recommended compiler boundaries:

```text
packages/scripts/compile-scenes/
  parser-analysis.ts
  validator-analysis.ts
  emitter-analysis.ts
  analysis-types.ts
```

Shared wire types that are consumed by both the compiler and layout/editor tooling belong in `@lyra/scene-types`. Runtime-only save formats remain Rust-owned and mirrored by frontend view types only where needed.

Compiler validation must reject:

- duplicate game-global fact/question/access IDs;
- missing referenced evidence, statements, facts, questions, grants, boards, buckets, slots, nodes, or edges;
- invalid `at_least` counts;
- impossible template requirements;
- threshold boards whose required independent source count exceeds available source groups;
- order boards with duplicate required sequence members;
- route graphs with missing nodes or disconnected mandatory paths;
- facts asserted by no successful resolution path;
- mandatory questions with no reachable resolving fact;
- cross-chapter references that violate the repository's reachability policy.

Authoring skills must be updated before story writers are asked to create production analysis scenes.

## Error handling

- Gameplay commands return typed `GameError` values and restore the pre-command snapshot on failure.
- Invalid placements produce structured player feedback, not an engine error.
- Unknown IDs, stale queue/board tokens, malformed saves, and inaccessible items are engine errors.
- Failed save writes leave the previous save file intact through write-to-temp plus atomic replace.
- Load validates the envelope before replacing current engine state.
- A failed load leaves the current session unchanged.
- Missing optional media assets use the existing placeholder path and remain diagnosable.

## Chapter 1 vertical slice

The first production use should be Chapter 1 Beat 8.5 because the narrative plan already defines it as a short evidence-organizing beat before Kitami is identified.

### Boards

1. **Classify the evidence packages**
   - Miyake's small lies;
   - earlier third-party route;
   - door-lock timing.
2. **Order the local events**
   - maintenance mode;
   - external maintenance credential;
   - staff credential;
   - server merge completion.
3. **Meet the narrow-extraction threshold**
   - choose at least two independent contradictions;
   - reject two cards that merely repeat the same time-source argument.

### Asserted facts

- `miyake_lies_are_unrelated_to_murder`;
- `an_earlier_external_entry_exists`;
- `merge_time_is_not_event_time`.

### Granted access

- `narrow_door_lock_extraction`.

### Integration rule

The existing final hearing remains the dramatic confrontation. Analysis proves the player's theory; the hearing proves it to Kamiya and the institution.

## Chapter 2 vertical slice

Chapter 2 exercises the expanded system after the Chapter 1 foundation is stable.

### Investigation map

Three clusters expose public scene, city observation, and logistics/person resolution locations.

### Boards

1. **Viewpoint board (`classify`)** — who saw the box, wall, composite feed, or device trace?
2. **Feed board (`compare`)** — align wall, fan phone, Program Composite, and QA frames.
3. **Route board (`route`)** — Glass Box → M-03 → Service Elevator B → vacant floor, with pass-expiry constraints.
4. **Capability board (`threshold` or `classify`)** — distinguish Saegusa's malice from Hasumi's access, control position, and motive.
5. **Control-room reaction chain (`chain`)** — director → AD → Hasumi response → PR template → security decision.

### Time model

Media frames and route events display both:

- absolute clock time;
- sponsor-relative `S+` time.

The UI must never render `S+00m45s` as though it means 00:45 a.m.

### Required facts

- `crowd_watched_the_wall_not_the_box`;
- `program_composite_is_not_raw_observation`;
- `hasumi_was_the_first_human_status_source`;
- `the_fifteen_minute_pass_opened_the_route`;
- `saegusa_lacked_the_required_access`;
- `hasumi_had_access_control_and_urgent_motive`.

## Rollout strategy

### Phase 0 — Persistence foundation

Ship save/load and Continue before adding more long-form mandatory gameplay.

### Phase 1 — Reasoning domain

Ship facts, questions, access grants, provenance metadata, unlock extensions, and the Case Archive data model.

### Phase 2 — Analysis core

Ship the `analysis` scene pipeline and first-release templates: classify, order, threshold.

### Phase 3 — Chapter 1 vertical slice

Convert Beat 8.5 into a production analysis scene and verify the complete investigation → analysis → hearing loop.

### Phase 4 — Investigation expression

Ship present/use evidence, context-aware wrong feedback, and progressive hints.

### Phase 5 — Chapter 2 support

Ship map metadata, frame strips, compare/route/chain templates, then author the four Chapter 2 boards.

### Phase 6 — Archive and resume polish

Complete the player-facing archive, objective tracking, save summaries, and replay-safe solved-board presentation.

## Testing strategy

### Compiler

- parser fixtures for each analysis template;
- invalid-reference and impossible-requirement fixtures;
- global ID collision tests;
- reachability tests for facts/questions/access grants;
- snapshot tests for emitted JSON;
- live `scenes:compile` verification.

### Rust

- template validation unit tests;
- board state transition tests;
- reveal idempotency tests;
- fact/question/access progression tests;
- unlock `at_least` tests;
- investigation item-use tests;
- save round-trip and failed-load atomicity tests;
- complete Chapter 1 playthrough test including analysis.

### Frontend

- keyboard and pointer interaction tests for each board;
- feedback and hint rendering tests;
- archive provenance rendering tests;
- save/load menu tests;
- map fallback tests when no metadata is authored;
- `S+` and absolute time display tests;
- reduced-motion behavior.

### End to end

- new game → acquire Chapter 1 evidence → solve Beat 8.5 → obtain narrow extraction → finish hearing → autosave;
- restart app → Continue → state is restored without duplicate acquisitions;
- incorrect analysis submissions never reveal facts or access grants;
- scene select in debug/replay remains safe and does not contaminate production progress.

## Acceptance criteria

The foundation is successful when:

1. A player can stop mid-chapter, resume, and retain all authoritative progress.
2. Chapter 1 requires the player to organize and submit a theory before the final hearing unlocks.
3. The engine records established facts separately from evidence.
4. The dossier makes lead/re-acquired/exhibit and raw/sync/summary distinctions visible.
5. At least one required progression gate accepts alternate independent evidence routes through deterministic rules.
6. Wrong submissions explain the logical gap without exposing the full solution.
7. Chapter 2 can represent independent observation sources, dual time labels, a constrained route, and a causal reaction chain without chapter-specific engine code.
8. Existing chapters and scene files compile and play unchanged when they do not use the new features.
9. All gameplay truth remains in Rust and all authoring remains compiler-validated.

## Rejected alternatives

### Reuse interrogation for every deduction

Rejected because a one-line/one-item contradiction cannot express source independence, ordering, route continuity, or procedural thresholds without turning dialogue into a hidden analysis engine.

### Restore the old deduction board unchanged

Rejected because the old concept was a single full-theory form. The story needs several reusable reasoning shapes and explicit facts/provenance, while retaining the strong principle of holistic submission.

### Build chapter-specific Svelte minigames

Rejected because they bypass the scene pipeline, duplicate state/validation logic, weaken authoring tooling, and make eight chapters expensive to test and maintain.

### Build a free-form evidence graph

Rejected because it creates ambiguous authoring and feedback, poor controller/keyboard accessibility, difficult validation, and excessive implementation cost for no required story benefit.

### Add a traditional penalty meter

Rejected because the story's meaningful failure state is overclaiming, failing an admissibility threshold, or losing access—not physical damage represented as HP.
