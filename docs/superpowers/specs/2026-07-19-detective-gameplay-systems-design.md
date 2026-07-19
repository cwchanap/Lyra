# Detective Gameplay Systems Design

**Date:** 2026-07-19  
**Status:** Program-level design for review  
**Scope:** Shared detective-gameplay architecture, persistence, and the Chapter 1/2 vertical slices. Each major subsystem requires its own focused implementation plan before code changes begin.

## Summary

Lyra already supports a strong baseline loop:

1. read linear dialogue,
2. inspect investigation hotspots and interview characters,
3. collect evidence and statements,
4. challenge a testimony line, and
5. present one evidence item or statement as the contradiction.

That loop is sufficient for an introductory Ace Attorney-style case, but the full story requires the player to perform a missing middle step: organize several truthful fragments into an explicit inference before using that inference in a hearing.

This design adds that middle layer without replacing the existing investigation or interrogation systems. The central addition is a fourth compiler-driven scene type, `analysis`, backed by Rust-owned deterministic state and reusable board templates. Analysis scenes let the player classify, order, compare, route, and connect evidence into authored facts. Those facts can unlock locations, questions, evidence access, and later hearing phases.

The program also adds the product foundations needed by multi-hour chapters:

- versioned save/load with autosave and Continue,
- first-class facts, open questions, objectives, and procedure authorizations,
- evidence provenance and proof-capability metadata,
- a case file that explains what the player knows and what remains unresolved,
- contextual wrong-answer feedback and progressive hints,
- investigation-time evidence use,
- staged investigation maps, and
- a static frame-strip/timecode viewer for Chapter 2 and later media-heavy cases.

The result is one reusable detective grammar rather than a bespoke minigame for every chapter.

## Narrative Drivers

The story bible establishes eight cases in which the evidence fragments are often true while the story assembled from them is false. Chapter 1 requires the player to separate Miyake's small lies, the earlier third-party route, and the local lock-event sequence. Chapter 2 requires the player to distinguish the glass box from the broadcast wall, composite feeds from direct observation, the fifteen-minute access route, and the person who could exploit it.

The system therefore must support these recurring player actions:

- group evidence by the claim it can support,
- distinguish independent sources from repeated observations of one source,
- place events in a defensible order,
- compare raw, synchronized, summarized, composite, physical, testimonial, and subjective records,
- build a route through locations and access gates,
- connect multiple contributors in a responsibility chain,
- request a procedural authorization after demonstrating a threshold of independent contradictions, and
- carry unresolved questions and cross-chapter anomalies forward without labeling them as spoilers.

## Goals

- Make the player perform the key inference instead of watching the detective explain it.
- Preserve one canonical truth and deterministic outcomes while allowing flexible investigation order.
- Support the eight-chapter evidence themes with a small set of reusable, compiler-validated templates.
- Keep Rust authoritative for rules, solutions, durable state, and save snapshots.
- Keep authored story content in Markdown and semantic IDs rather than filesystem paths or frontend-only rules.
- Preserve the current `linear`, `investigation`, and `interrogation` scene contracts.
- Make evidence provenance, procedural status, and proof limits visible to the player.
- Make Chapters 1 and 2 the validation slices before expanding the system to later chapters.
- Support keyboard, assistive technology, reduced motion, and non-pointer alternatives for every analysis interaction.
- Make a three-to-four-hour chapter safe to leave and resume.

## Non-goals

- A freeform corkboard or unrestricted evidence graph.
- LLM-evaluated theories or natural-language answer grading.
- Multiple truths, branching culprit identities, or alternate canon endings.
- Traditional health points, punitive trial lives, or irreversible failure states.
- Real-time countdown puzzles or reaction-based quick-time events.
- A large open world.
- Full video decoding, editing, or frame-accurate media playback in the first release.
- Replacing authored testimony cross-examination with analysis boards.
- Building every later-chapter template before the Chapter 1 vertical slice is proven.
- Rewriting generated scene JSON by hand.

## Existing Architecture and Gap

Lyra is a Tauri 2 desktop application with a SvelteKit static SPA frontend and a Rust `GameEngine` that owns mutable game state. Authored Markdown is compiled into generated scene JSON. The runtime currently recognizes three scene types:

- `linear`,
- `investigation`, and
- `interrogation`.

Investigation state supports sublocations, hotspots, characters, topics, evidence, statements, reveal targets, and boolean unlock trees. Interrogation supports inquiry phases, testimony lines, a single authored contradiction per line, and evidence presentation. The frontend renders full `GameStateView` snapshots returned by Tauri commands.

The missing capabilities are structural rather than cosmetic:

- there is no durable fact produced by combining evidence,
- there is no reusable analysis scene,
- evidence records do not describe their source layer or procedural status,
- unlocks cannot express named facts, named authorizations, negation, or threshold counts,
- evidence can be presented only during interrogation,
- the case file is a flat evidence/statement inventory,
- there is no production save/load path, and
- Chapter 2's staged map and dual-time media evidence do not fit the current public view types.

## Chosen Program Shape

The program is divided into five independently reviewable stages:

1. **Persistence and story state** — save/load, facts, questions, objectives, authorizations, provenance, and unlock/reveal extensions.
2. **Analysis Scene MVP** — compiler contract, Rust runtime, Svelte workbench, and the `classify`, `order`, and `threshold` templates.
3. **Chapter 1 vertical slice** — playable Beat 8.5 boards that produce facts and a narrow-extraction authorization consumed by the existing final hearing.
4. **Chapter 2 expansion** — `compare` and `route`, staged city-map navigation, a frame-strip/timecode viewer, and investigation-time evidence interactions.
5. **Later-chapter platform** — `chain`, richer archive views, authoring/editor support, and migration hardening.

No stage should bundle all five into one implementation branch. Each stage must leave the game buildable, testable, and playable.

## Ownership Boundaries

| Concern | Owner | Responsibility |
|---|---|---|
| Authored semantics | Markdown scene files | Prompts, cards, slots, solutions, feedback copy, facts, objectives, questions, authorizations, unlocks, and reveal intent |
| Shared wire contracts | `@lyra/scene-types` where the runtime/editor share byte-identical data | Scene index and analysis/map layout values that must not drift |
| Compiler AST and validation | `packages/scripts/compile-scenes` | Parse, type, validate, and emit analysis content and new story references |
| Durable gameplay rules | Rust `GameEngine` | Analysis drafts, validation, facts, questions, objectives, authorizations, investigation interactions, save snapshots, and public views |
| Tauri commands | `apps/game/src-tauri/src/lib.rs` and game modules | Typed command boundary; no frontend answer keys |
| Frontend state and presentation | `apps/game/src/lib` and `apps/game/src/routes` | Render returned state, maintain only transient UI state, and send semantic IDs back to Rust |
| Layout authoring | `apps/layout-editor` | Read-only support first; interactive authoring only after the runtime contract stabilizes |

The frontend must never decide whether an analysis submission is correct. It renders public candidates and feedback returned by Rust.

## Core Story-State Model

### Evidence provenance

Every evidence record may carry optional `EvidenceProvenance` metadata:

```ts
type EvidenceOriginLayer =
  | "physical"
  | "testimony"
  | "raw"
  | "sync"
  | "summary"
  | "composite"
  | "subjective"
  | "metadata"
  | "unspecified";

type EvidenceProceduralStatus = "lead" | "reacquired" | "exhibit";
type EvidenceCompleteness = "complete" | "partial" | "cropped";
type EvidenceConfidence = "confirmed" | "disputed" | "superseded";

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

type EvidenceProvenance = {
  originLayer: EvidenceOriginLayer;
  proceduralStatus: EvidenceProceduralStatus;
  completeness: EvidenceCompleteness;
  confidence: EvidenceConfidence;
  sourceGroupId: string | null;
  capabilities: ProofCapability[];
};
```

`sourceGroupId` identifies observations derived from the same underlying source. Five fan videos of one broadcast wall can therefore remain five records while counting as one independent observation source.

Legacy evidence receives a neutral hidden default:

- `originLayer: "unspecified"`,
- `proceduralStatus: "exhibit"`,
- `completeness: "complete"`,
- `confidence: "confirmed"`,
- no source group, and
- no declared capabilities.

The UI does not show an `unspecified` badge. The compiler warns only when an analysis board relies on provenance or capabilities that a referenced record does not declare.

### Facts

A fact is a durable proposition that the player has explicitly established through authored gameplay. It is not another evidence card.

```ts
type FactRecord = {
  id: string;
  label: string;
  summary: string;
  details: string;
  category: string;
  sourceBoardId: string;
  supportingItemIds: string[];
  assertedInChapterId: string;
  assertedInSceneId: string;
};
```

Examples include:

- `miyake_lies_are_unrelated`,
- `earlier_external_entry_exists`,
- `merge_time_is_not_event_time`,
- `crowd_watched_wall`, and
- `control_room_relied_on_hasumi`.

Facts appear in the case file and can unlock later content.

### Questions

Questions preserve open problems without spoiling the answer.

```ts
type QuestionRecord = {
  id: string;
  label: string;
  summary: string;
  status: "open" | "resolved";
  resolvedByFactIds: string[];
};
```

Cross-chapter questions use neutral wording, such as "Why do unrelated cases contain a roughly ninety-second gap?" rather than "What is A-90?" before the story has earned that name.

### Objectives

Objectives tell the player what they are presently trying to prove.

```ts
type ObjectiveRecord = {
  id: string;
  label: string;
  summary: string;
  status: "active" | "completed";
};
```

Objectives are authored and resolved through the same deterministic reveal/unlock machinery as facts.

### Procedure authorizations

Procedure is modeled as named grants rather than a numeric life or credibility meter.

```ts
type AuthorizationRecord = {
  id: string;
  label: string;
  summary: string;
  grantedInChapterId: string;
  grantedInSceneId: string;
};
```

Examples include:

- `narrow_lock_export`,
- `batch_raw_export`, and
- `witness_identity_admitted`.

A grant may unlock a scene, phase, evidence record, or media view. Wrong submissions never permanently consume a grant opportunity.

### Durable analysis state

Rust owns, serializes, and exposes:

- each board's lock/completion state,
- the current typed draft,
- failure count,
- requested hint level,
- the accepted resolution,
- asserted facts,
- resolved questions,
- completed objectives, and
- granted authorizations.

The frontend may animate a drag operation locally, but it sends the complete typed draft after every completed drop, selection, connection, or reorder. Leaving and returning to a board therefore preserves the submitted arrangement.

## Fourth Scene Type: `analysis`

### Scene contract

The compiler adds `analysis` to the chapter scene union and recognizes files named `analysis_scene_<K>.md`.

An analysis scene contains:

- scene identity and title,
- intro dialogue,
- one or more ordered boards,
- fact, question, objective, and authorization definitions referenced by that scene,
- optional evidence/statement manifests if the scene itself reveals items,
- an outro unlock and dialogue, and
- semantic asset/audio references using the existing asset pipeline.

Boards are a tagged union. A generic untyped `config` object is not permitted.

Common board fields are:

```ts
type AnalysisBoardBase = {
  id: string;
  label: string;
  prompt: string;
  required: boolean;
  status: "locked" | "unlocked";
  unlock: StoryUnlockExpr | null;
  cards: AnalysisCardDefinition[];
  reveals: AnalysisRevealTarget[];
  onCorrect: DialogueItem[];
  feedbackRules: AnalysisFeedbackRule[];
  hints: AnalysisHint[];
};
```

A card may reference an inventory evidence item, an inventory statement, an already asserted fact, or an authored case-note card. This supports Chapter 1 local event cards without inventing fake evidence items.

```ts
type AnalysisCardSource =
  | { kind: "evidence"; id: string }
  | { kind: "statement"; id: string }
  | { kind: "fact"; id: string }
  | { kind: "caseNote"; id: string; label: string; summary: string };
```

The solution is emitted only to the Rust resource model. Public views contain cards, slots, groups, current drafts, completion state, hints already revealed, and structured feedback, but never accepted answers.

### MVP templates

#### `classify`

The player assigns required cards to authored groups. The evaluator checks the complete mapping. A group may accept multiple cards, and an authored card may have exactly one accepted group in the MVP.

Chapter 1 uses this to sort material into:

- Miyake's unrelated small lies,
- the earlier third-party route, and
- the lock chronology.

#### `order`

The player places required cards in a total order. The MVP accepts one canonical order, with optional fixed anchor cards displayed but not draggable.

Chapter 1 uses this for `Event-1841` through `Event-1844` and the distinction between local order and later merge time.

#### `threshold`

The player selects a minimum number of eligible cards while satisfying authored independence constraints. The evaluator supports:

- minimum selected count,
- minimum distinct `sourceGroupId` count,
- required proof capabilities,
- forbidden procedural statuses, and
- an optional authored eligible-card set.

Chapter 1 uses this to require two independent contradictions before granting narrow extraction. Selecting two cards derived from the same source does not pass.

### Expansion templates

These templates are defined in the program design but implemented only after the MVP is accepted.

#### `compare`

The player aligns records across two or more columns or layers. It supports Chapter 2 wall/composite/direct-observation comparisons and Chapter 6 raw/sync/summary comparisons.

#### `route`

The player orders and connects authored map nodes along one or more valid paths. It supports Chapter 2's outbound route and Hasumi's separate return route. Multiple authored valid paths are permitted when the story allows equivalent evidence routes.

#### `chain`

The player connects cause, intervention, omission, and consequence nodes with authored directed edges. It supports Chapter 3's dual-responsibility case and Chapter 7's information-denial chain. It is not a freeform graph; only declared nodes and accepted edge sets are valid.

### Runtime flow

1. Entering an analysis scene plays its intro dialogue through the existing dialogue queue.
2. Rust advances to the first unlocked incomplete required board.
3. The frontend renders the typed board view.
4. Every completed interaction sends a full typed draft to Rust.
5. Submit asks Rust to evaluate the stored draft.
6. A wrong submission returns structured feedback, increments the failure count, and preserves the draft.
7. A correct submission marks the board complete, stores the accepted resolution, plays `onCorrect`, and applies reveals.
8. Reveals may assert facts, resolve questions, complete objectives, grant authorizations, reveal evidence/statements, or unlock later boards/scenes.
9. When all required boards and the outro condition are complete, the engine advances to the next scene.

## Extended Reveal and Unlock Language

The existing evidence, statement, topic, hotspot, question, and phase predicates remain valid.

The shared story unlock language adds:

- `fact_asserted`,
- `question_resolved`,
- `objective_completed`,
- `analysis_completed`,
- `authorization_granted`,
- unary `not`, and
- `at_least` over a non-empty list of child expressions.

`and` and `or` remain binary in the serialized form for backward compatibility. `at_least` handles flexible paths without deeply nested boolean trees.

The reveal union adds:

- fact assertion,
- question reveal/resolution,
- objective reveal/completion,
- authorization grant, and
- analysis-board/analysis-scene unlock where required.

Compiler validation rejects:

- unresolved IDs,
- impossible thresholds,
- duplicate IDs across one chapter namespace,
- self-referential unlocks,
- unlock cycles,
- required boards whose required cards can never become visible,
- authorization gates with no reachable grant, and
- facts declared but never assertable.

## Save, Load, Autosave, and Continue

### User-facing behavior

Lyra provides:

- one rolling autosave,
- three manual save slots,
- a Continue action that loads the newest valid save,
- save metadata showing chapter, scene, active objective, play timestamp, and save type,
- an overwrite confirmation for occupied manual slots, and
- a clear incompatibility message rather than silently resetting progress.

Manual save is available from the game menu after a command has returned and the game is not in an in-flight mutation. The current dialogue item, analysis board, investigation state, and interrogation state are valid save points.

### Autosave policy

A debounced autosave runs after every successful command that changes durable state, including:

- scene or chapter transitions,
- evidence or statement acquisition,
- fact assertion,
- question/objective change,
- authorization grant,
- analysis draft or completion changes,
- investigation progress, and
- interrogation progress.

The autosave writer waits until the current successful command has committed. It writes atomically to a temporary file, fsyncs where supported, replaces the active autosave, and retains one previous autosave backup.

### Save envelope

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

The snapshot stores stable semantic IDs and mutable state, not full authored scene definitions. On load, Rust reloads current scene definitions from packaged resources, validates referenced IDs, and applies snapshot state.

### Compatibility policy

- `schemaVersion` controls explicit data migrations.
- `contentRevision` records the compiled story revision.
- Matching schema and content revision load directly.
- Matching schema with a different content revision performs ID validation.
- Unknown optional completed content is dropped with a warning.
- A missing current chapter, scene, required board, or inventory definition rejects the save as incompatible.
- Corrupt primary saves fall back to the previous atomic backup.
- The loader never mutates or overwrites an incompatible file until the player deliberately replaces it.

Audio preferences remain separate user preferences and are not duplicated into each game save.

## Case File, Objective, and Recap

The existing evidence menu evolves into a case file with five MVP sections:

1. **Current Objective** — active and recently completed objectives.
2. **Evidence** — evidence details, provenance, procedure status, confidence, source group, and proof capabilities.
3. **Statements** — current statements and their provenance where supplied.
4. **Established Facts** — propositions the player has personally proved.
5. **Open Questions** — neutral unresolved problems and resolved history.

The case file does not label an open question as a main-story clue. Cross-chapter questions appear alongside case questions with neutral copy.

Continue and save-slot cards use authored chapter/scene summaries plus the active objective. No generated or LLM-written recap is required.

People, locations, complete chronology, and social-response archives are deferred until the Chapter 1 vertical slice proves the MVP information architecture.

## Investigation-Time Evidence Interactions

Investigation gains one generic action: present or use a collected item on an authored target.

Supported target kinds are:

- character,
- topic,
- hotspot, and
- sublocation interaction point.

Supported item kinds are evidence and statements.

The Rust command receives semantic target and item IDs. An authored interaction declares:

- accepted item IDs or capability/status rules,
- correct dialogue,
- optional item-specific wrong dialogue,
- capability-mismatch feedback,
- default wrong dialogue, and
- reveals.

This supports actions such as:

- showing a filming-position diagram to a fan,
- using an access table on a service-door hotspot,
- presenting a delivery record to a witness,
- comparing an account statement with a manager's claim, and
- unlocking a topic only after a relevant exhibit is presented.

The system does not generate a full evidence-by-character matrix. Only authored interactions are interactive.

## Procedure Gates

Procedure is represented by named authorizations and threshold boards, not by a health bar.

A hearing may require the player to demonstrate enough independent contradictions to receive an authorization. That authorization can unlock a limited export, a larger export, an admissibility ruling, or a witness-standing phase.

The Chapter 1 vertical slice grants `narrow_lock_export`. Chapter 6 can later grant `limited_raw_export` and then `batch_raw_export`. Chapter 8 can grant evidence-admissibility and witness-identity authorizations.

Wrong submissions produce a reasoned rejection and preserve the opportunity to try again. The game never becomes unwinnable because a player tested a plausible but procedurally insufficient argument.

## Contextual Feedback and Progressive Hints

Every analysis board may provide feedback rules in this precedence order:

1. exact item or exact combination,
2. prohibited procedural status,
3. duplicate `sourceGroupId`,
4. missing proof capability,
5. structurally incomplete draft, and
6. default feedback.

Feedback describes the proof limitation rather than saying only "wrong." Examples include:

- "This establishes time, not identity."
- "Both clips are derived from the broadcast wall; they are not independent observations."
- "This is still a lead and has not been reacquired as an exhibit."
- "The route reaches the empty floor but does not explain the return path."

Boards expose up to four authored hint levels:

1. restate the question,
2. identify the relevant evidence package or source layer,
3. identify the missing proof capability or independence rule,
4. name the specific card set or next connection.

Hints are requested deliberately from the workbench. A later accessibility option may offer them automatically after repeated failures, but the MVP does not impose automatic hints.

## Media, Timecode, and Map Support

### Static frame-strip viewer

The first media feature uses authored still frames rather than full video playback. A media evidence record may contain:

- ordered frame assets,
- absolute timestamps,
- an optional relative time axis such as Chapter 2's `S+` sponsor offset,
- source-layer and source-group metadata,
- camera/viewpoint labels,
- optional authored overlays that can be toggled, and
- short annotations unlocked by facts or authorizations.

Chapter 2 displays absolute time and sponsor offset simultaneously. `S+00m45s` is visibly aligned with `00:00:45 a.m.` and cannot be mistaken for `00:45 a.m.`.

The viewer is an evidence-detail surface and a card source for `compare`; it is not a standalone video editor.

### Staged investigation map

Chapter 2 adds an authored map definition with:

- normalized node positions,
- node-to-sublocation mapping,
- visible/locked state,
- stage or cluster membership,
- optional edges,
- completion markers, and
- a current objective summary.

The map uses the existing investigation sublocations and unlock rules. It does not create a second navigation state. Phase A, B, and C reveal additional nodes while the chapter manifest remains deterministic.

The current `ExploreView` HUD injection point hosts the map/objective control without replacing the investigation scene surface.

## Chapter 1 Vertical Slice

The first content integration targets Chapter 1 Beat 8.5. It must not rewrite the existing case or replace the final hearing.

The analysis scene contains three required boards:

1. **Evidence packages (`classify`)**  
   Sort current material into Miyake's unrelated small lies, the earlier third-party route, and the lock chronology.

2. **Local event sequence (`order`)**  
   Order `Event-1841` through `Event-1844` and distinguish local event order from the later server merge timestamp.

3. **Narrow-extraction request (`threshold`)**  
   Select at least two independent contradictions that directly challenge the lock chronology. Two records from the same source group do not satisfy the request.

The boards assert:

- `miyake_lies_are_unrelated`,
- `earlier_external_entry_exists`, and
- `merge_time_is_not_event_time`.

The threshold board grants:

- `narrow_lock_export`.

The existing final hearing consumes these facts and authorization to unlock the relevant phases and present the dramatic evidence in testimony. The workbench makes the player understand the theory; the hearing makes the player prove it to other people.

Chapter 1 is the acceptance gate for:

- persistence,
- facts/questions/objectives,
- provenance,
- new unlock/reveal targets,
- analysis compilation,
- all three MVP templates,
- case-file integration,
- feedback/hints,
- autosave inside analysis, and
- end-to-end accessibility.

## Chapter 2 Expansion

Chapter 2 validates flexible investigation order and richer source reasoning.

The expansion includes:

- the staged Shibuya map,
- the dual absolute/`S+` time axis,
- the static frame-strip viewer,
- `compare`,
- `route`,
- investigation-time evidence interactions, and
- four authored analysis boards.

The four boards are:

1. **Sightline board** — classify who watched the glass box, the broadcast wall, a composite feed, or a side view.
2. **Image-source board** — compare wall, fan-phone, Program Composite, and QA frames to establish what each source can prove.
3. **Route board** — connect the back safety position, sponsor corridor, M-03, service elevator B, and the empty floor; then separately establish Hasumi's return path.
4. **Person board** — compare Saneda's public malice with Hasumi's access, control position, motive, and irreversible trigger.

The resulting facts include:

- `crowd_watched_wall`,
- `composite_is_not_direct_observation`,
- `maintenance_route_reached_empty_floor`,
- `return_route_did_not_use_expired_pass`,
- `saneda_lacks_access`, and
- `hasumi_has_access_control_and_motive`.

Optional side investigations may strengthen evidence, change dialogue, or add case-file context. They must not be the only source of a required fact.

## Authoring and Compiler Validation

The compiler must provide targeted diagnostics with source file and line information.

Required validation includes:

- valid scene filename/type pairing,
- unique scene, board, card, group, slot, fact, question, objective, and authorization IDs,
- all card sources resolve,
- all solution references are declared,
- all required cards can become visible,
- all reveal and unlock references resolve,
- no unlock cycles,
- exact `order` solutions contain every required card once,
- `classify` solutions assign every required card once,
- `threshold` requirements are satisfiable from eligible cards and source groups,
- feedback-rule predicates reference valid capabilities/statuses/source groups,
- hint levels are ordered and non-empty,
- facts asserted by a board are declared,
- authorizations required by content have reachable grant paths,
- map nodes reference valid sublocations,
- route solutions reference valid map edges or declared direct links, and
- media frames have monotonic absolute and relative time mappings.

The compiler emits generated resources only after all blocking errors pass. Non-blocking warnings cover neutral provenance on records used only for display and unused optional cards.

## Frontend Interaction and Accessibility

- Every drag operation has an equivalent keyboard action using select/move/confirm controls.
- Cards, groups, slots, and connections expose names and state through semantic buttons, lists, and live regions.
- Correctness is not communicated by color alone.
- Focus returns to the relevant board control after feedback or a hint closes.
- Escape follows the existing one-layer-per-press coordinator contract.
- The case file and hint panel trap focus only while modal.
- `prefers-reduced-motion` removes card-flight, line-draw, and result animations.
- Analysis submissions are never triggered by an accidental background click.
- The system supports 1280x720 without hiding submit, hint, or back controls.
- Screen-reader copy names the current board, completion state, selected card, destination, and feedback reason.

## Failure Handling

- An invalid draft returns a typed error and leaves the last valid durable draft intact.
- A wrong but well-formed submission is gameplay feedback, not an application error.
- Duplicate or stale frontend actions are guarded by board/view generation tokens, matching the dialogue queue's stale-token philosophy.
- Save failure surfaces a non-blocking persistent warning and retains the prior valid save.
- Load failure never partially mutates the active game engine; loading is transactional.
- Missing optional media assets use existing story-asset placeholders and do not block logic.
- Missing required authored cards, maps, or solution references are compile-time errors rather than runtime fallbacks.
- Jump-to-scene debug support grants required candidate inventory and story-state prerequisites only in debug builds.

## Testing Strategy

### Compiler

- parser fixtures for every analysis template,
- invalid fixtures for missing IDs, impossible thresholds, cycles, duplicate cards, invalid routes, and bad time mappings,
- emitter snapshots for analysis scenes and new story records,
- chapter manifest acceptance for `analysis`, and
- audit coverage for provenance-dependent boards.

### Rust engine

- story-state reveal and unlock tests,
- typed draft mutation tests,
- correct and wrong evaluation for every template,
- source-group independence tests,
- authorization grant tests,
- transactional save/load round trips,
- schema migration and incompatible-content tests,
- investigation evidence-interaction tests, and
- full Chapter 1 playthrough coverage.

### Frontend

- case-file sections and badges,
- keyboard and pointer parity for every board template,
- focus/Escape behavior,
- structured feedback and hints,
- dual-time display,
- staged map navigation,
- save-slot and Continue behavior, and
- reduced-motion behavior.

### End to end

The built Tauri app must prove:

- new game to Chapter 1 analysis completion,
- save during an incomplete analysis draft and resume with the draft intact,
- wrong threshold submission with contextual feedback,
- correct independent-source submission granting narrow extraction,
- continuation into the existing final hearing,
- return to title and Continue,
- manual save overwrite confirmation, and
- Chapter 2 map/board progression once that stage is implemented.

## Rollout and Compatibility

- Save/load can ship before any authored analysis scene.
- Story-state fields use empty defaults so existing Chapter 1 content still compiles and runs.
- `analysis` enters the chapter manifest only when the Chapter 1 vertical slice is ready.
- Legacy evidence remains usable with neutral provenance.
- The current investigation and interrogation Markdown formats remain valid.
- Generated resources are never committed manually.
- Layout-editor support begins read-only; authored Markdown remains the source of truth.
- Each new template is guarded by compiler fixtures, Rust tests, frontend tests, and one authored acceptance board before later chapters use it.

## Alternatives Not Chosen

### One bespoke minigame per chapter

This would maximize chapter-specific presentation but duplicate state, validation, accessibility, save, and editor logic. It would also make later story revisions expensive. Rejected in favor of a reusable typed board grammar.

### Frontend-only analysis

This would be fast to prototype, but it would put answer keys and correctness rules in Svelte, complicate saves, and drift from the Rust-authoritative engine. Rejected.

### Freeform graph deduction

A freeform corkboard is expressive but difficult to author, validate, hint, save, test, and make accessible. Rejected. `route` and `chain` provide constrained graph-like interactions with explicit authored solutions.

### Numeric credibility or trial health

A meter would add punishment but not reasoning. The story's procedural stakes are better modeled as named authorizations with reasoned denials. Rejected.

### Full video pipeline first

Chapter 2 can prove its media reasoning with authored frame strips and dual time markers. Full video decoding would add packaging, seek, codec, performance, and test complexity before the gameplay grammar is proven. Deferred.

## Program Acceptance Criteria

The program-level design is satisfied when:

- the game can save and resume any durable scene state,
- facts, questions, objectives, authorizations, and provenance are first-class runtime data,
- an authored `analysis` scene compiles and runs without frontend answer keys,
- Chapter 1's three boards are playable, accessible, saved, and consumed by the final hearing,
- the case file clearly separates evidence from established facts and open questions,
- wrong submissions explain proof limitations and never make the case unwinnable,
- Chapter 2 can distinguish shared observation sources, compare media layers, and reconstruct two routes,
- investigation can use evidence on authored targets,
- all new content is compiler-validated and covered by Rust/frontend/E2E tests, and
- later chapters can add `compare`, `route`, or `chain` content without a new bespoke runtime mode.

## Required Follow-up Specifications

Before implementation begins, the following focused specs and executable plans must be approved independently:

1. Save/load snapshot and compatibility design.
2. Story state, provenance, and unlock/reveal contract.
3. Analysis scene Markdown/compiler contract.
4. Analysis Rust runtime and public view contract.
5. Analysis workbench interaction and accessibility design.
6. Chapter 1 Beat 8.5 content integration.
7. Chapter 2 map/media/compare/route expansion.
8. Investigation evidence-interaction contract.

This umbrella document defines their shared boundaries; it does not authorize a single all-at-once implementation branch.
