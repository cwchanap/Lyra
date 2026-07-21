# Detective Gameplay Systems Decision Locks

**Date:** 2026-07-19  
**Revised:** 2026-07-21  
**Status:** Normative amendment to the umbrella design and high-level plan

Focused subsystem specs may add detail, but they must not reverse these choices without updating the umbrella design, high-level plan, PR description, and affected Linear tickets.

## 1. PR #23 and HPA-254 are canonical

The “Detective Gameplay Systems” program in PR #23 and Linear HPA-254 is the single source of truth.

PR #24 and the HPA-239 “Detective Gameplay Foundations” tree are superseded and must not be used as a second implementation contract.

## 2. Narrative canon precedence is fixed

When story documents conflict:

1. Chapter 1 Final Writing Plan V3.7.
2. Chapter 2 Plan V0.7 Timecode / Control-Room Reaction Lock.
3. Story Bible V6.5 Canon Sync Patch.
4. Story Bible V6.4.
5. Older notes.

## 3. Chapter 1 Beat 8.5 uses one analysis scene

The Chapter 1 manifest replaces the playable `scene_8_5.md` entry with:

```text
analysis_scene_8_5.md
```

The existing transition dialogue moves into the analysis scene intro/outro. Both files do not remain as playable manifest entries, and the analysis is not a frontend-only overlay.

## 4. Progression is monotonic

The unlock language has positive predicates, `and`, `or`, and `at_least`.

It does not include generic `not`. Once content becomes unlocked or visible, ordinary positive story-state mutations cannot re-lock it.

## 5. Definitions and mutable state are separate

The compiler emits a game-wide story catalog for immutable fact, question, objective, authorization, and global record definitions.

Saves store mutable state plus stable IDs and definition hashes. They do not copy all authored labels, prose, or accepted solutions.

## 6. ID scopes are explicit

Evidence, statements, facts, questions, objectives, authorizations, and chapters are game-global.

Scenes are chapter-local and durable references use chapter ID + scene ID. Boards are scene-local and durable references use chapter ID + scene ID + board ID. Cards, groups, slots, hotspots, topics, sublocations, and map nodes remain local to their owning authored unit.

## 7. Provenance is shared and orthogonal

Evidence and statements use `CaseRecordProvenance`.

Source kind, representation layer, procedural status, completeness, confidence, source group, proof capabilities, and supersession are separate dimensions. Legacy defaults are unspecified/empty and cannot silently satisfy metadata-dependent rules.

## 8. Lead → reacquired → exhibit uses immutable records

A formally reacquired or admitted version is a new record that supersedes the earlier lead. The earlier record remains inspectable.

Do not erase acquisition origin or procedure history by mutating one record in place from lead to exhibit.

## 9. Facts carry support lineage

A fact records its assertion origin, supporting record IDs, and supporting fact IDs. The engine can compute transitive record support.

For the MVP, source-independent threshold boards accept evidence and statement cards only; facts and free case notes cannot be used to manufacture an extra independent source count.

## 10. Objectives have one primary active item

The runtime may show secondary objectives, but exactly one primary objective is active. Save-slot and Continue summaries use the primary objective.

## 11. Procedure uses named grants, not a score

The program does not add credibility points, hearing health, consumable objections, or permanent lockout.

An analysis board may establish that a request is justified, but the institution represented in the story grants the authorization.

For Chapter 1:

- Beat 8.5 completes `prepare_narrow_lock_request` and establishes its supporting facts.
- The review hearing grants `narrow_lock_export` after the request is accepted.

## 12. Analysis drafts are durable

Every completed placement, classification, selection, reorder, or connection updates Rust-owned draft state. Saving during an incomplete board restores the same draft.

Available boards may be selected explicitly. `required` controls scene completion, not basic board accessibility. Completed boards reopen in read-only review mode.

## 13. Correct resolution is one atomic transaction

Board completion, accepted draft, facts/objectives/authorizations, inventory/provenance reveals, acquisition-event creation, and result-dialogue installation commit together.

If a reveal fails, none of those durable effects survive. Repeated submission cannot replay them.

## 14. Mid-dialogue saves use stable queue origins

Saves do not serialize arbitrary copied dialogue prose.

They store a stable queue origin, definition hash, and cursor, allowing Rust to reconstruct the authored queue. Active/incomplete queue definitions require exact hash compatibility or an explicit migration.

## 15. Acquisition acknowledgement is durable

Pending evidence/statement acquisition notifications are represented as Rust-owned durable events with acknowledged state.

Saving during acquisition dialogue cannot lose the eventual acquisition popup or replay the inventory mutation.

## 16. Content compatibility uses definition hashes

Matching semantic IDs are insufficient when an active board, route, queue, or solution changes.

Active/incomplete definitions require matching hashes or explicit migrations. Completed historical content may be grandfathered only through a documented migration that preserves its durable outputs.

## 17. Map state is derived from investigation state

Map metadata owns node position, mapped sublocation, cluster, optional edges, and display information.

Visibility, lock, current, and completion state come from the mapped investigation sublocation. The map does not create a second navigation state.

## 18. Chapter 2 includes a control-room reaction board

Chapter 2 has five required analysis beats:

1. sightline classification,
2. image-source comparison,
3. control-room reaction order,
4. outbound/return route reconstruction,
5. person/capability resolution.

The control-room sequence uses the existing `order` grammar and does not wait for the later `chain` template.

## 19. Chapter 2 person conclusions remain separate

Do not collapse access, first-response control, and motive into one broad fact.

At minimum, Chapter 2 separately establishes:

- Hasumi had sponsor access.
- Hasumi controlled the first human status response.
- Hasumi had an urgent financial/control motive.
- Saneda lacked the required access.

## 20. Chapter 2 starts only after the Chapter 1 acceptance gate

`compare`, `route`, staged map, media/timecode, investigation item use, and Chapter 2 content integration do not begin until the Chapter 1 analysis/save packaged Tauri end-to-end path passes.