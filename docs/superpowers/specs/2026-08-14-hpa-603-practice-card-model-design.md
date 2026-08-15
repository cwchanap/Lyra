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
- save schema/capture/restore and test fixtures still serialize or construct the dead set;
- compiler reachability still emits `practice:<id>` atoms and requires every Analysis practice card as an implicit runtime prerequisite;
- Rust tests/comments still describe an Investigation → Analysis transfer that no longer exists;
- the Investigation authoring skill omits `practice:` from legal reveal syntax and says all local reveals collect/unlock same-file targets;
- the Analysis authoring skill still describes Practice cards as being “revealed/collected” rather than context-bound.

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

This is mechanically simpler at runtime but would require touching parser/schema/content simply to remove useful static provenance between the tutorial investigation and the following Analysis scene.

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

All `SceneProgressSnapshot::Investigation` construction sites and tests must use the smaller current-format shape. This includes save storage/discovery tests, not only schema/capture/restore.

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

### 5.4 Navigation test semantics

Keep direct Investigation → Analysis navigation and adjacency behavior unchanged, but rename the existing test that still says a Practice card is “transferred”. Its assertion should describe the actual contract: after the authored tutorial interaction advances into Analysis, the authored-static Practice card can be selected and submitted without any transfer state.

## 6. Save design

Remove `practice_card_ids` from the current `SceneProgressSnapshot::Investigation` wire and from every current-format snapshot constructor, capture path, restore path, and storage/discovery fixture.

No migration or compatibility shim is required. Lyra is still pre-release and has no external save consumers; retaining an unused field would preserve dead architecture for no product value.

The change is intentionally breaking for any local development save written with the previous snapshot shape.

Do not bump into a sibling V2 DTO and do not add migration code.

The red test must be a **semantic assertion**, not a compile failure: construct the current pre-change Investigation snapshot including `practice_card_ids: vec![]`, serialize it, and assert `practiceCardIds` is absent. That test compiles on `main` and fails because the field is currently emitted; after deletion, update the constructor to the smaller shape and keep the same assertion green.

## 7. Compiler and reachability design

### 7.1 Keep dedicated Practice binding validation

`validatePracticeCardBindings` remains the owner of the authoring relationship.

Keep these rules:

1. one practice ID may belong to only one Analysis board in a chapter;
2. every Practice card must have exactly one matching `practice:<id>` marker in the immediately preceding Investigation scene;
3. every `practice:<id>` marker must target a Practice card in the immediately following Analysis scene.

Update comments, variable names where practical, diagnostics, and compile-integration test language to call this a **binding/context marker**, not an acquired card or collection source.

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

Evidence and Statement effects remain unchanged. `inboundTargetsFromInvestigationReveals` already returns no inbound target for Practice and needs no change.

This makes compiler reachability match runtime truth:

- Evidence/Statement must be obtainable before an Analysis board can use them.
- Practice is statically authored into the board and has no runtime acquisition prerequisite.

### 7.3 Reachability test shape

Do not test this with a mixed Practice + Case File threshold. Threshold validation intentionally rejects that shape with `analysisThresholdPracticeMixedSources`.

Do not use the small `buildNodes(...)` helper for Analysis assertions; it builds `buildReachabilityNodes` with an empty Analysis registry and therefore cannot produce Analysis board nodes.

Pin two valid cases through the same full Analysis path already used by `analysisChapterFixture`:

1. **Practice-only Analysis board:** its `implicitPrerequisites` contains no `practice:<id>` atom.
2. **Case File Analysis board:** Evidence/Statement sources still produce `evidence:<id>` / `statement:<id>` prerequisites.

The test setup must run through `createAnalysisDefinitionRegistryFromScenes` → `compileCaseRecordCorpus` → `validateAnalysisScenes` → `buildReachabilityNodes({ analysisScenes, normalizedAnalysisScenes, ... })`, so the assertions exercise the real normalized Analysis path.

The existing Investigation-side test for P1-local Practice reveal effects remains useful but changes expectation: the hotspot still emits its hotspot-completion atom, while the `practice:<id>` marker emits no reachability effect.

### 7.4 HPA-601 becomes obsolete

HPA-601 assumes a runtime where Practice cards are transferred only when collected. That assumption is no longer true once HPA-603 is consolidated.

An optional Practice marker cannot soft-lock the Analysis runtime because the marker is not a runtime gate. The dedicated binding validator still catches missing or miswired authoring context.

Therefore do **not** implement a Practice-specific `mustAtoms` rule or a broader may-vs-must redesign as part of this task.

## 8. Navigation and authoring boundary

Keep `validate_analysis_scene_adjacency`.

Its purpose is tutorial structure, not acquisition transfer:

> an Analysis scene containing Practice cards must immediately follow an Investigation scene so the authored cards have concrete investigative context.

Keep the Chapter 1 P1 `practice:` reveal lines and `analysis_scene_p1_5.md` unchanged. They are valid static bindings and remain useful to writers/reviewers.

### 8.1 Investigation authoring skill

The binding marker is authored on Investigation `Reveals:`, so `.claude/skills/writing-investigation-scene/SKILL.md` is part of the contract and must be updated in the same implementation task.

It must state that:

- `practice:<id>` is a legal Investigation reveal marker in addition to the five ordinary local target kinds;
- it does **not** collect an item, play `On Collect`/`On Acquire`, enter Case File, mutate StoryState, or unlock a same-file block;
- it context-binds that Investigation interaction to a Practice card in the immediately following Analysis scene;
- the compiler validates the exact one-to-one ID and immediate adjacency relationship;
- ordinary evidence/statement/topic/hotspot/sublocation same-file resolution rules remain unchanged.

The current generic sentence “all local reveals newly add an item or unlock a block and resolve in the same file” must explicitly exclude Practice markers.

### 8.2 Analysis authoring skill

`.claude/skills/writing-analysis-scene/SKILL.md` must be rewritten consistently, not patched in only one paragraph.

Replace every remaining Practice sentence that says cards are “revealed”, “collected”, “owned”, or “transferred” with the static binding model:

- Practice cards are authored-static tutorial cards and never Case File inventory;
- each `practice:<id>` source is context-bound exactly once by a matching marker in the immediately preceding Investigation;
- the marker is not an acquisition gate;
- Practice cards are available whenever their Analysis board is available;
- immediate Investigation → Analysis adjacency remains mandatory.

The self-check and checklist must use “bound/context-bound”, not “revealed/collected”.

`.agents/skills` is a symlink to `.claude/skills`; do not duplicate the edits into a second skill tree.

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
- Investigation reveal execution with a Practice target has no acquisition state to mutate;
- the direct Investigation → Analysis navigation test is renamed/reworded to prove authored-static availability rather than transfer;
- current save round-trip/discovery tests pass with the smaller Investigation snapshot, including `save/storage.rs` literals.

Avoid a new packaged E2E suite. HPA-265 already covers the real Chapter 1 Analysis journey; HPA-603 does not change player-facing board interactions.

### Compiler

Add/adjust focused tests proving:

- Practice markers are still required and one-to-one bound by `validatePracticeCardBindings`;
- compile integration calls this an immediate predecessor binding, not tutorial collection;
- a Practice-only Analysis board has no Practice reachability prerequisite;
- a Practice reveal does not publish a reachability atom;
- Evidence/Statement Analysis cards remain reachability-gated through the full normalized Analysis path;
- production Chapter 1 still compiles.

The old HPA-601 fixture expectation — optional Practice marker causes a downstream soft-lock error — must not be added because it encodes the rejected acquisition model.

## 12. Scope boundaries

### In scope

- remove dead Investigation Practice acquisition state;
- remove its current-save serialization and every current-format snapshot literal;
- make Practice reveal an explicit runtime no-op;
- align compiler reachability with authored-static Practice behavior;
- keep and clarify static Practice binding/adjacency rules;
- update both Investigation and Analysis authoring skills as one contract;
- reword focused validator/compile integration tests away from collection language;
- update focused Rust/compiler tests.

### Out of scope

- Analysis-side Practice persistence;
- save migrations/backward compatibility;
- Chapter 2 Analysis templates;
- generalized inventory/source framework;
- changes to Evidence/Statement availability;
- drag-and-drop UX (HPA-621);
- broader reachability may-vs-must redesign;
- changing P1 tutorial content;
- stripping `RevealTarget::Practice` from emitted JSON/wire syntax.

## 13. Acceptance criteria

- [ ] `AnalysisCardSource::Practice` remains authored-static and always available when its board is available.
- [ ] Investigation runtime contains no Practice acquisition set or transfer state.
- [ ] Practice reveal execution is an explicit no-op and never enters Case File/StoryState.
- [ ] Current save snapshots and storage fixtures no longer persist/construct Practice IDs; no migration layer is added.
- [ ] the direct Investigation → Analysis test describes authored-static Practice availability, not transfer.
- [ ] Compiler reachability no longer produces or requires `practice:<id>` atoms.
- [ ] Evidence/Statement reachability behavior is unchanged and pinned through the full normalized Analysis test path.
- [ ] Practice binding/adjacency validation still rejects missing, duplicate, or miswired contextual markers.
- [ ] validator and compile-integration wording no longer describes Practice as collection/acquisition.
- [ ] both Investigation and Analysis authoring skills describe the same compile-time binding semantics.
- [ ] Chapter 1 P1 tutorial content compiles unchanged.
- [ ] HPA-601 remains closed as superseded/obsolete by the consolidated static model.
- [ ] No new runtime subsystem, save DTO version, second validator pass, Practice must-path rule, or Chapter 2 abstraction is introduced.
