# HPA-603 Practice-Card Model Consolidation Design

**Date:** 2026-08-14  
**Status:** Ready for implementation  
**Linear:** HPA-603  
**Baseline:** `main` at `761e3bf542062775c0fc8fea4e989380fbf738b8` after HPA-265 / PR #56

## 1. Goal

Resolve the split practice-card model left after HPA-260 by making one semantic choice end to end:

> **Practice cards are authored-static Analysis material. Investigation `practice:` reveals are compile-time context bindings, not runtime acquisitions.**

The player still investigates the P1 tutorial interactions before reaching the immediately following Analysis scene, but the runtime does not maintain or persist a second set of acquired practice-card IDs.

This is a cleanup and contract-alignment task. It must not add a new progression system, save migration framework, or Chapter 2 abstraction.

## 2. Current repository truth

The current implementation already behaves as authored-static on the Analysis side:

- `AnalysisSceneState` has no `practice_card_ids` state.
- `AnalysisSceneState::card_is_available()` returns `true` for `AnalysisCardSource::Practice`.
- Analysis save state persists drafts/feedback/active board, not practice acquisition.
- `advance_scene` no longer copies practice IDs from Investigation into Analysis.
- the P1 production tutorial remains safe because `investigation_scene_p1` uses auto outro and all four practice-producing hotspots are unlocked; Investigation auto-outro requires every unlocked hotspot/topic to be completed before exit.

At the same time, an obsolete acquisition model still exists elsewhere:

- `InvestigationSceneState.practice_card_ids` and `record_practice_card()` still mutate local state;
- `RevealTarget::Practice` still records into that set;
- save capture/restore still serializes the set;
- compiler reachability still emits `practice:<id>` atoms and requires every Analysis practice card as an implicit runtime prerequisite;
- comments still describe an Investigation → Analysis transfer that no longer exists.

The dedicated compiler binding validator and navigation adjacency rule serve a different purpose and remain useful: they statically prove that tutorial cards are grounded in an immediately preceding investigation interaction.

## 3. Decision

Adopt **authored-static runtime + compile-time contextual binding**.

### Runtime meaning

A Practice card is available whenever its Analysis board is available. It is not inventory and has no acquisition state.

`RevealTarget::Practice` remains in the compiled wire because current authored scenes already use it to identify the investigation interaction associated with a tutorial card. At runtime the target is an intentional no-op.

### Compiler meaning

A `practice:<id>` reveal means:

> “This investigation interaction is the authored context/source for the practice card with this ID in the immediately following Analysis scene.”

It does **not** mean:

> “Executing this interaction grants a runtime token required to use the card.”

The compiler continues to require a one-to-one contextual binding and direct Investigation → Analysis adjacency, but reachability must not model `practice:<id>` as a progress atom.

## 4. Alternatives considered

### A. Restore acquisition-gated Practice cards — reject

This was the original HPA-603 recommendation. It would re-add:

- `AnalysisSceneState.practice_card_ids`;
- Investigation → Analysis transfer logic;
- debug-jump prepopulation;
- final-board clearing rules;
- Analysis-side save state;
- must-path compiler rules such as HPA-601.

That recreates a second progression model solely for tutorial cards and conflicts with HPA-260's existing “derived, not duplicated” runtime design. It also expands persistence and navigation complexity without improving the current Chapter 1 player experience.

### B. Delete Practice reveal syntax entirely — reject for now

This is mechanically simpler at runtime but would require touching parser/schema/content/authoring docs simply to remove useful static provenance between the tutorial investigation and the following Analysis scene.

The current syntax gives the compiler a cheap way to catch:

- typoed/unbound practice IDs;
- one ID reused by multiple Analysis boards;
- practice cards with no immediately preceding Investigation context;
- investigation markers with no corresponding next Analysis card.

Keep that authoring value without turning it into runtime state.

### C. Authored-static runtime + compile-time contextual binding — chosen

This removes dead state while preserving useful authoring validation. It matches current Analysis behavior and requires no new abstraction.

## 5. Runtime design

### 5.1 Investigation state

Remove `practice_card_ids` from `InvestigationSceneState` and remove `record_practice_card()`.

After this change Investigation owns only state that can affect Investigation behavior or must be resumed:

- inspected hotspots;
- discussed topics;
- entered sublocations;
- local unlock overrides;
- dialogue lifecycle state.

### 5.2 Practice reveal execution

Keep the existing `RevealTarget::Practice` Rust variant so compiler-emitted Chapter 1 resources do not need a content/schema rewrite.

In `apply_reveals_and_build_queue`, handle it explicitly as a no-op:

```rust
RevealTarget::Practice { .. } => {
    // Authoring-only context marker. The compiler binds this interaction to
    // the immediately following Analysis practice card; runtime availability
    // is authored-static and carries no acquisition state.
}
```

Do not send Practice through `AcquisitionCtx`, do not create Case File records, and do not emit a story-state effect.

### 5.3 Analysis availability

Keep the current behavior unchanged:

```rust
AnalysisCardSource::Practice { .. } => true
```

Evidence and Statement cards remain inventory-gated. No new availability helper or Practice-specific state is introduced.

## 6. Save design

Remove `practice_card_ids` from the current `SceneProgressSnapshot::Investigation` wire and from capture/restore.

No migration or compatibility shim is required. Lyra is still pre-release and has no external save consumers; retaining an unused field would preserve dead architecture for no product value.

The change is intentionally breaking for any local development save written with the previous snapshot shape.

Do not bump into a sibling V2 DTO and do not add migration code.

## 7. Compiler and reachability design

### 7.1 Keep dedicated Practice binding validation

`validatePracticeCardBindings` remains the owner of the authoring relationship.

Keep these rules:

1. one practice ID may belong to only one Analysis board in a chapter;
2. every Practice card must have exactly one matching `practice:<id>` marker in the immediately preceding Investigation scene;
3. every `practice:<id>` marker must target a Practice card in the immediately following Analysis scene.

Update comments/diagnostics to call this a **binding/context marker**, not an acquired card or collection source.

Do not add a second validator pass.

### 7.2 Remove Practice from runtime reachability

`buildAnalysisNodes` currently creates an implicit prerequisite for every card source. Change that to create implicit prerequisites only for runtime-acquired card kinds:

```ts
implicitPrerequisites: uniquePredicates(
  board.common.cards.flatMap((card) =>
    card.source.kind === "practice"
      ? []
      : [{ predicate: "atom" as const, atom: `${card.source.kind}:${card.source.id}` }],
  ),
),
```

`effectsFromInvestigationReveals` currently emits an atom for Practice. Change Practice to emit no reachability effect:

```ts
case "practice":
  return [];
```

Evidence and Statement effects remain unchanged.

This makes compiler reachability match runtime truth:

- Evidence/Statement must be obtainable before an Analysis board can use them.
- Practice is statically authored into the board and has no runtime acquisition prerequisite.

### 7.3 HPA-601 becomes obsolete

HPA-601 assumes a runtime where Practice cards are transferred only when collected. That assumption is no longer true once HPA-603 is consolidated.

An optional Practice marker cannot soft-lock the Analysis runtime because the marker is not a runtime gate. The dedicated binding validator still catches missing or miswired authoring context.

Therefore do **not** implement a Practice-specific `mustAtoms` rule or a broader may-vs-must redesign as part of this task.

## 8. Navigation and authoring boundary

Keep `validate_analysis_scene_adjacency`.

Its purpose is tutorial structure, not acquisition transfer:

> an Analysis scene containing Practice cards must immediately follow an Investigation scene so the authored cards have concrete investigative context.

Update comments only if needed; do not relax the rule in HPA-603.

Keep the Chapter 1 P1 `practice:` reveal lines and `analysis_scene_p1_5.md` unchanged. They are valid static bindings and remain useful to writers/reviewers.

Update the Analysis authoring skill to state that:

- Practice cards are tutorial-only and never Case File inventory;
- the preceding Investigation must bind each Practice ID exactly once;
- the binding is compile-time context, not a runtime acquisition gate;
- Practice cards are available when the Analysis board is available.

## 9. Data flow after HPA-603

```text
Investigation Markdown
  hotspot/topic `Reveals: [practice:p1_x]`
          |
          | compile-time binding only
          v
validatePracticeCardBindings
  exact ID + immediate predecessor relationship
          |
          | emitted wire keeps Practice marker
          v
Rust Investigation reveal handler
  explicit no-op
          |
          v
Analysis scene loads
  Practice card authored in board definition
  -> card_is_available = true
  -> no transfer state
  -> no save field
```

For production evidence/statement Analysis cards the existing path is unchanged:

```text
Investigation/interrogation acquisition
-> Inventory
-> Analysis card_is_available(Evidence/Statement)
```

## 10. Error handling

No new runtime error is needed.

Authoring mistakes remain compile failures through the existing Practice binding diagnostics. Runtime receives already validated packaged resources and simply ignores Practice marker effects.

Do not add “practice card missing” runtime errors, fallback transfers, or defensive save repair logic.

## 11. Testing strategy

### Rust

Pin the semantic decision directly:

- existing `validate_draft_availability_accepts_practice_cards_without_inventory` stays green;
- Investigation reveal execution with a Practice target leaves no mutable Practice state because that state no longer exists;
- current save round-trip tests pass with the smaller Investigation snapshot.

Avoid a new packaged E2E suite. HPA-265 already covers the real Chapter 1 Analysis journey; HPA-603 does not change player-facing board interactions.

### Compiler

Add/adjust focused tests proving:

- Practice markers are still required and one-to-one bound by `validatePracticeCardBindings`;
- a Practice card is not an Analysis reachability prerequisite;
- a Practice reveal does not publish a reachability atom;
- Evidence/Statement Analysis cards remain reachability-gated;
- production Chapter 1 still compiles.

The old HPA-601 fixture expectation — optional Practice marker causes a downstream soft-lock error — must not be added because it encodes the rejected acquisition model.

## 12. Scope boundaries

### In scope

- remove dead Investigation Practice acquisition state;
- remove its current-save serialization;
- make Practice reveal an explicit runtime no-op;
- align compiler reachability with authored-static Practice behavior;
- keep and clarify static Practice binding/adjacency rules;
- update focused tests and authoring documentation.

### Out of scope

- Analysis-side Practice persistence;
- save migrations/backward compatibility;
- Chapter 2 Analysis templates;
- generalized inventory/source framework;
- changes to Evidence/Statement availability;
- drag-and-drop UX (HPA-621);
- broader reachability may-vs-must redesign;
- changing P1 tutorial content.

## 13. Acceptance criteria

- [ ] `AnalysisCardSource::Practice` remains authored-static and always available when its board is available.
- [ ] Investigation runtime contains no Practice acquisition set or transfer state.
- [ ] Practice reveal execution is an explicit no-op and never enters Case File/StoryState.
- [ ] Current save snapshots no longer persist Practice IDs; no migration layer is added.
- [ ] Compiler reachability no longer produces or requires `practice:<id>` atoms.
- [ ] Evidence/Statement reachability behavior is unchanged.
- [ ] Practice binding/adjacency validation still rejects missing, duplicate, or miswired contextual markers.
- [ ] Chapter 1 P1 tutorial content compiles unchanged.
- [ ] HPA-601 is closed as superseded/obsolete by the consolidated static model.
- [ ] No new runtime subsystem, save DTO version, or Chapter 2 abstraction is introduced.
