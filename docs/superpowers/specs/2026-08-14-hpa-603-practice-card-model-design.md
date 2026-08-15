# HPA-603 Practice-Card Model Consolidation Design

**Date:** 2026-08-14  
**Status:** Ready for implementation  
**Linear:** HPA-603  
**Baseline:** `main` at `761e3bf542062775c0fc8fea4e989380fbf738b8` after HPA-265 / PR #56

## 1. Goal

Resolve the split Practice-card model left after HPA-260 with one end-to-end semantic contract:

> **Practice cards are authored-static Analysis material. Investigation `practice:` reveals are compile-time context bindings, not runtime acquisitions.**

The runtime must not maintain, transfer, or persist Practice acquisition state. At the same time, a Practice card must not appear in the tutorial Analysis scene before the player has actually performed the Investigation interaction that gives that card meaning.

HPA-603 therefore owns two separate concerns:

1. **Availability:** Practice cards are static and never acquisition-gated.
2. **Tutorial coherence:** each Practice card is bound to a predecessor interaction that the compiler can prove the player must perform before an auto-completing Investigation exits.

This remains a cleanup and narrow authoring-contract task. It must not add a new progression system, save migration framework, general reachability pass, or Chapter 2 abstraction.

## 2. Current repository truth

The current implementation already behaves as authored-static on the Analysis side:

- `AnalysisSceneState` has no `practice_card_ids` state.
- `AnalysisSceneState::card_is_available()` returns `true` for `AnalysisCardSource::Practice`.
- Analysis save state persists drafts/feedback/active board, not Practice acquisition.
- `advance_scene` no longer copies Practice IDs from Investigation into Analysis.

Dead acquisition machinery still survives elsewhere:

- `InvestigationSceneState.practice_card_ids` and `record_practice_card()`;
- `RevealTarget::Practice` mutating that set;
- current-format save schema/capture/restore/storage test literals carrying Practice IDs;
- compiler reachability emitting `practice:<id>` atoms and requiring them as Analysis prerequisites;
- Rust tests/comments describing Investigation → Analysis transfer;
- authoring skills using collection/reveal language that no longer matches runtime behavior.

The production P1 tutorial happens to be coherent today because:

- its predecessor Investigation uses an **auto** outro;
- all four Practice markers live on initially-unlocked hotspots;
- their parent sublocation is initially unlocked.

Runtime auto completion requires every currently unlocked hotspot/topic inside unlocked sublocations to be completed before exit. That makes the four P1 interactions mandatory.

That safety is content-specific, not yet a compiler contract. In particular:

- an expression-gated outro can exit without completing all unlocked interactions;
- a marker on a locked hotspot/topic can remain unseen;
- a hotspot/topic inside a locked sublocation is skipped by the auto-completion sweep;
- a marker on sublocation entry itself is not guaranteed by auto completion, because auto completion does not independently require every unlocked sublocation to be entered.

Removing Practice reachability atoms without replacing this tutorial-coherence invariant would let a future Practice card appear without the player ever seeing its intended context.

## 3. Decision

Adopt **authored-static runtime + compile-time contextual binding + a narrow guaranteed-context rule**.

### 3.1 Runtime meaning

A Practice card is available whenever its Analysis board is available. It is not inventory and has no acquisition state.

`RevealTarget::Practice` remains in the compiled wire because authored scenes use it to identify the Investigation interaction associated with the tutorial card. At runtime the target is an intentional no-op.

### 3.2 Binding meaning

A `practice:<id>` marker means:

> “This Investigation interaction is the authored context for the Practice card with this ID in the immediately following Analysis scene.”

It does **not** mean:

> “Executing this interaction grants a runtime token required to use the card.”

The compiler continues to enforce one-to-one ID binding and direct Investigation → Analysis adjacency.

### 3.3 Guaranteed-context rule

Because Practice availability is static, the compiler must also guarantee that the contextual interaction is mandatory before the predecessor exits.

HPA-603 deliberately supports only the simple shape already used by Chapter 1:

1. the predecessor Investigation outro is `auto`;
2. the Practice marker is authored on a **hotspot or topic**, not on sublocation entry;
3. that hotspot/topic has initial `Status: unlocked`;
4. its parent sublocation has initial `Status: unlocked`.

Under current runtime semantics, those conditions are sufficient: auto outro cannot complete until that unlocked hotspot is inspected or that unlocked topic is discussed.

Reject Practice markers that do not satisfy this safe subset. Do not attempt a general proof for conditionally unlocked carriers or expression-gated outros in HPA-603.

This is intentionally narrower than HPA-601. HPA-601 was about preventing a runtime soft-lock caused by missing acquired Practice state. HPA-603 removes that acquisition gate entirely. The new rule protects **tutorial coherence**, not runtime availability.

If a later chapter genuinely needs a Practice marker on a conditional carrier, sublocation entry, or expression-gated predecessor, extend the authoring contract then with a concrete use case rather than building a generic must-path framework now.

## 4. Alternatives considered

### A. Restore acquisition-gated Practice cards — reject

This would re-add:

- `AnalysisSceneState.practice_card_ids`;
- Investigation → Analysis transfer logic;
- debug-jump prepopulation;
- clearing rules;
- Analysis-side save state;
- Practice-specific must-path rules.

That recreates a second progression/save model solely for tutorial cards and conflicts with HPA-260's derived-availability design.

### B. Delete Practice reveal syntax entirely — reject for now

The syntax still gives the compiler useful provenance between a tutorial interaction and the next Analysis card. Deleting it would trade away a cheap authoring check merely to remove one wire variant.

### C. Keep static Practice cards but document “writers must make the marker mandatory” — reject

This is smaller in code but leaves the only player-coherence invariant unenforced. The compiler already owns Practice binding and already traverses every Practice marker; extending that existing validator is cheaper and safer than relying on playtest discipline.

### D. Static runtime + binding + narrow guaranteed-context validator — chosen

This deletes dead state, preserves useful authoring validation, and adds only a small behavioral rule inside the existing Practice binding pass. No new pass, solver, registry, or runtime subsystem is required.

## 5. Runtime design

### 5.1 Investigation state

Remove `practice_card_ids` from `InvestigationSceneState` and remove `record_practice_card()`.

After HPA-603 Investigation owns only state that affects Investigation behavior or resume:

- inspected hotspots;
- discussed topics;
- entered sublocations;
- local unlock overrides;
- dialogue lifecycle state.

All current-format `SceneProgressSnapshot::Investigation` construction sites and tests use the smaller shape.

### 5.2 Practice reveal execution

Keep `RevealTarget::Practice` in the Rust schema, but handle it explicitly as a no-op:

```rust
RevealTarget::Practice { .. } => {
    // Compiler-only context marker for the immediately following
    // authored-static Analysis Practice card.
}
```

Do not route Practice through `AcquisitionCtx`, inventory, Case File, `StoryState`, or save state.

### 5.3 Analysis availability

Keep current behavior unchanged:

```rust
AnalysisCardSource::Practice { .. } => true
```

Evidence and Statement remain inventory-gated.

### 5.4 Navigation semantics

Keep direct Investigation → Analysis navigation and the existing adjacency validator.

Rename the stale navigation test that says a Practice card is “transferred”. The test should describe the actual behavior: after the mandatory tutorial interaction and scene transition, the authored-static Practice card is selectable and can be submitted without transfer state.

## 6. Save design

Remove `practice_card_ids` from the current `SceneProgressSnapshot::Investigation` wire and every current-format construction/pattern.

The complete known Rust surface on the baseline includes:

- `scenes/investigation.rs` state/init/method/test literal;
- `reveals.rs` writer;
- `save/schema.rs` field;
- `save/capture.rs` production capture and expected snapshot test literal;
- `save/restore.rs` restore pattern/assignment and test snapshot literal;
- `save/storage.rs` discovery/load test literal.

Use `rg "practice_card_ids|record_practice_card" apps/game/src-tauri/src/game` as the exhaustive guard after deletion.

No migration or compatibility shim is required. The current save DTO uses `deny_unknown_fields`, so a pre-change local development save may fail loudly after the field is removed. Do not add `serde(alias)`, `skip_serializing`, a V2 sibling DTO, or repair logic.

The red save test must be semantic rather than a compile failure: construct the current pre-change Investigation snapshot including `practice_card_ids: vec![]`, serialize it, and assert `practiceCardIds` is absent. It fails on current `main` because the field is emitted; after deletion, update the constructor to the smaller shape and keep the same assertion.

## 7. Compiler design

### 7.1 Reuse `validatePracticeCardBindings`

Keep the existing Practice binding pass as the single owner. Do not add a second validator pass.

Preserve these rules:

1. one Practice ID belongs to only one Analysis board in a chapter;
2. every Practice card has exactly one matching marker in the immediately preceding Investigation;
3. every Investigation Practice marker targets a Practice card in the immediately following Analysis.

Reword comments, variables, diagnostics, and compile-integration test names away from collection/acquisition terminology. Tests should continue to assert diagnostic **codes and behavior**, not exact prose.

### 7.2 Add guaranteed-context validation in the same pass

Extend `forEachPracticeReveal` so the visitor knows enough about the marker carrier to evaluate the safe subset without invoking reachability:

- carrier kind: `sublocation | hotspot | topic`;
- carrier initial status when applicable;
- parent sublocation initial status;
- source file/line.

For each bound Practice marker, reject it with one focused Practice-context diagnostic when any of these is true:

- predecessor outro is not `auto`;
- carrier is a sublocation entry;
- hotspot/topic carrier is not initially unlocked;
- parent sublocation is not initially unlocked.

A table-driven validator test should pin the invalid shapes plus one valid auto/unlocked hotspot case.

Do not use `mustAtoms`, `mustReachableNodeKeys`, or a new reachability analysis. This validator is intentionally a simple syntactic guarantee matching runtime auto-completion semantics.

### 7.3 Remove Practice from runtime reachability

`buildAnalysisNodes` should create implicit card prerequisites only for runtime-acquired source kinds:

```ts
implicitPrerequisites: uniquePredicates(
  board.common.cards.flatMap((card) =>
    card.source.kind === "practice"
      ? []
      : [{ predicate: "atom" as const, atom: `${card.source.kind}:${card.source.id}` }],
  ),
),
```

`effectsFromInvestigationReveals` should emit no atom for Practice:

```ts
case "practice":
  return [];
```

Evidence/Statement behavior remains unchanged. `inboundTargetsFromInvestigationReveals` already ignores Practice and needs no change.

### 7.4 Reachability test shape

Do not use the local `buildNodes(...)` helper for Analysis board assertions; it uses an empty Analysis registry.

Do not invent a mixed Practice + Case File threshold; threshold validation intentionally rejects that shape.

Pin two valid cases through the real normalized Analysis path:

1. **Practice-only classify board:** no Practice implicit prerequisite.
2. **Existing Case File board:** Evidence/Statement prerequisites remain.

The Practice-only test should use inline Markdown source in `reachability.test.ts`, not add fixture files. Parse the inline Investigation and Analysis source, create the Analysis registry, compile the empty/minimal case-record corpus, validate Analysis, then call `buildReachabilityNodes` with `analysisScenes` and `normalizedAnalysisScenes`.

The matching Investigation Practice marker may remain in the inline source for realism, but `validatePracticeCardBindings` is not part of this reachability unit-test path; the test is specifically about Analysis node construction.

The existing Investigation-side reachability test remains useful: after HPA-603 the hotspot still emits its hotspot-completion atom, while the Practice marker emits no progress atom.

### 7.5 HPA-601 remains obsolete

HPA-601's soft-lock premise depends on Practice being a runtime acquisition prerequisite. HPA-603 removes that premise, so do not implement its Practice-specific `mustAtoms` proposal.

The guaranteed-context rule above is deliberately separate: it ensures the tutorial card has been experienced before it appears, without making Practice availability depend on a stored token.

## 8. Authoring contract

### 8.1 Investigation skill

Update `.claude/skills/writing-investigation-scene/SKILL.md` so `practice:<id>` is a legal **special context marker**, distinct from the five ordinary same-file reveal targets.

State all of the following:

- it does not collect, acquire, unlock, enter Case File, mutate `StoryState`, or play `On Collect`/`On Acquire`;
- it binds to a Practice card in the immediately following Analysis scene;
- the predecessor Investigation must use auto outro;
- the marker must be on an initially-unlocked hotspot/topic;
- the marker's parent sublocation must be initially unlocked;
- do not put a Practice marker on sublocation entry in the current contract;
- ordinary evidence/statement/topic/hotspot/sublocation same-file rules remain unchanged.

### 8.2 Analysis skill

Update `.claude/skills/writing-analysis-scene/SKILL.md` consistently:

- Practice cards are authored-static tutorial cards, never Case File inventory;
- each Practice source is context-bound exactly once by the immediately preceding Investigation;
- the binding marker must satisfy the guaranteed-context rule above;
- the marker is not a runtime availability gate;
- Practice cards are available whenever their board is available;
- immediate Investigation → Analysis adjacency remains mandatory;
- threshold no-mixing/provenance-neutral rules remain unchanged.

Rewrite all stale Practice-specific “revealed”, “collected”, “owned”, or “transferred” language. `.agents/skills` is a symlink to `.claude/skills`; edit only `.claude/skills`.

## 9. Data flow after HPA-603

```text
Investigation Markdown
  unlocked hotspot/topic under unlocked sublocation
  Reveals: [practice:p1_x]
          |
          | existing binding validator
          | + guaranteed-context check
          v
compiled Practice marker
          |
          | runtime explicit no-op
          v
Analysis scene loads
  authored Practice card
  card_is_available = true
  no transfer state
  no save field
```

For Evidence/Statement Analysis cards the existing path remains:

```text
Investigation/interrogation acquisition
-> Inventory
-> reachability atom
-> Analysis availability check
```

## 10. Testing strategy

### Rust

- semantic save-wire red/green test;
- all current-format Practice state literals removed;
- stale navigation transfer test renamed/reworded;
- existing Analysis Practice-without-inventory test stays green.

### Compiler

- existing binding diagnostics continue to assert codes/structure, not exact message prose;
- new table-driven test rejects non-guaranteed Practice contexts;
- valid auto + initially-unlocked hotspot marker passes;
- Practice reveal emits no reachability atom;
- inline Practice-only classify board has no Practice prerequisite through the normalized Analysis path;
- existing Case File Analysis board retains Evidence/Statement prerequisites;
- end-to-end unbound Practice test is renamed/reworded but keeps its diagnostic-code assertion;
- production Chapter 1 still compiles unchanged.

No new packaged E2E suite is needed.

## 11. Scope boundaries

### In scope

- delete dead Investigation Practice acquisition/save state;
- make Practice runtime reveal handling a no-op;
- keep Practice wire syntax;
- keep one-to-one binding and adjacency validation;
- add the narrow guaranteed-context rule inside the existing validator;
- remove Practice from reachability atoms/prerequisites;
- preserve Evidence/Statement gating;
- update both authoring skills and stale test/comment language.

### Out of scope

- Analysis-side Practice persistence;
- save migration/backward compatibility;
- deleting the Practice wire variant;
- conditional-carrier proof or general Investigation must-path analysis;
- Practice-specific `mustAtoms`;
- new reachability pass;
- Chapter 2/generalized Analysis architecture;
- drag-and-drop UX (HPA-621);
- changing Chapter 1 P1 content.

## 12. Acceptance criteria

- [ ] Practice has one runtime model: authored-static, never acquisition-gated.
- [ ] Investigation runtime/save state contains no Practice acquisition set or ID field.
- [ ] `RevealTarget::Practice` is an explicit runtime no-op.
- [ ] Practice binding remains one-to-one and immediate Investigation → Analysis.
- [ ] every accepted Practice marker is provably completed before predecessor auto outro: hotspot/topic initially unlocked, parent sublocation initially unlocked.
- [ ] expression-gated predecessors, locked carriers/parents, and sublocation-entry Practice markers are rejected.
- [ ] compiler reachability neither produces nor requires Practice atoms.
- [ ] Evidence/Statement reachability and runtime availability are unchanged.
- [ ] both authoring skills describe the same static binding + guaranteed-context contract.
- [ ] Chapter 1 P1 compiles unchanged.
- [ ] HPA-601 remains canceled; no Practice `mustAtoms` rule is introduced.
- [ ] no migration layer, second validator pass, new E2E suite, or Chapter 2 abstraction is added.
