# HPA-261 Chapter 1 Analysis Workbench UI Design

**Date:** 2026-08-08  
**Status:** Draft for review  
**Linear:** HPA-261  
**Baseline:** HPA-259 is merged through PR #37; HPA-260 is in progress in parallel; reviewed against current `main` and the temporary threshold-only Analysis UI in open PR #44

## 1. Goal

Build the smallest reusable Svelte workbench needed to play the real Chapter 1 Beat 8.5 `classify`, `order`, and `threshold` boards while keeping Rust authoritative for all gameplay truth.

The first version must:

- render the answer-key-free public Analysis view owned by HPA-260;
- let pointer and keyboard players produce the same semantic drafts;
- support board selection, classify assignment, order manipulation, threshold selection, remove, one-step undo, reset, submit, optional hint, feedback, and solved-board review;
- preserve the existing `GameShell`, Case File, dialogue, persistence overlays, audio routing, Escape ownership, and gameplay-input isolation;
- remain usable at the current 1280×720 target;
- meet the first-version accessibility floor without turning HPA-261 into a release-hardening project.

This is a Chapter 1 workbench, not a generic graph/template renderer.

## 2. Current repository and dependency context

### HPA-259 is the stable authored-contract baseline

The merged compiler/Rust wire already defines the three closed Analysis board families and the real Beat 8.5 immutable fixture:

- `classify` with public groups and hidden accepted group mapping;
- `order` with public fixed anchors and hidden accepted order;
- `threshold` with public `minimumSelected` and hidden accepted selections;
- public card source references to already-acquired evidence/statements;
- authored incomplete/incorrect copy and optional static hint.

HPA-261 must not reproduce compiler validation or hidden answers in TypeScript.

### HPA-260 owns mutable runtime truth

HPA-260 is implementing the Rust authority needed by this UI:

- active/available/completed boards;
- typed mutable drafts;
- direct evaluation;
- failure feedback;
- qualified completion and story effects;
- exact persistence;
- `AnalysisActionToken` stale-action fencing;
- answer-key-free public `ModeView::Analysis` / `SceneView::Analysis`;
- `select_analysis_board`, `update_analysis_draft`, and `submit_analysis_board` commands.

HPA-261 can proceed against typed fixtures matching that public contract. HPA-262 remains responsible for proving fixture parity against live runtime responses and the complete Chapter 1 vertical slice.

### PR #44 overlap is a migration seam, not a dependency

Open PR #44 currently contains a small threshold-only `AnalysisView.svelte` used by a tutorial board. That code proves the basic page routing and native-button interaction are viable, but its contract deliberately rejects `classify` and `order`.

HPA-261 must not create a second permanent Analysis UI next to it.

Implementation rule:

- start from current `main` when HPA-261 implementation begins;
- if PR #44 has merged, replace/generalize its threshold-only `AnalysisView` into the workbench described here and migrate only useful styles/tests;
- remove temporary `set_analysis_selection` / `submit_analysis_selection` frontend seams if they exist after the rebase and use HPA-260's three semantic commands;
- if PR #44 has not merged, implement the workbench directly without depending on its branch.

## 3. Approaches considered

### Approach A — one workbench host + three focused board components — **recommended**

Use one `AnalysisWorkbench` for common scene chrome, progress, feedback, hint, undo/reset, submit, and focus behavior. Branch directly on the closed `board.kind` union and render one focused component for `classify`, `order`, or `threshold`. Reuse a small `AnalysisCard` presentation component.

**Advantages**

- maps exactly to the three committed Chapter 1 board families;
- each interaction model stays understandable and independently testable;
- no renderer registry, plugin API, drag framework, or graph abstraction;
- future change stays local without forcing one large component to understand every interaction.

**Cost**

- a few more files than a monolith.

### Approach B — one monolithic `AnalysisWorkbench.svelte`

Put all three board variants and all focus/interaction rules in one file.

**Advantages**

- smallest initial file count.

**Problems**

- classify assignment, order-slot movement, threshold badges, shared feedback, and focus return quickly become tangled;
- tests become broad and brittle;
- the file would be the first place future changes accumulate unrelated conditions.

This saves minutes at scaffolding time and costs more during iteration.

### Approach C — generic template renderer / drag-and-drop framework

Create a board renderer registry and generic card-placement/connection primitives intended to cover future `compare`, `route`, or `chain` templates.

**Rejected**

- violates HPA-261 and HPA-254's explicit Chapter 1-first/YAGNI boundary;
- adds abstractions without production content pressure;
- drag-and-drop would require a second non-drag interaction model for keyboard accessibility anyway;
- increases HPA-262 integration risk for no Chapter 1 benefit.

## 4. Ownership boundary

### Rust/public view owns

The UI treats the HPA-260 public view as authoritative for:

- active board and action token;
- board availability/visibility;
- completion/read-only state;
- cards, groups, fixed anchors, `minimumSelected`;
- current draft;
- failure kind and authored visible copy;
- optional authored hint;
- inventory/provenance records referenced by cards.

### Svelte may own only presentation mechanics

Svelte may calculate or remember:

- which visible card currently has keyboard/pointer selection inside the classify UI;
- display ordering derived from the current public draft plus public fixed anchors;
- selected count and visible progress text;
- which public record corresponds to a card source reference;
- one previous public draft for a one-step Undo convenience;
- temporary hint-expanded state;
- focus-return targets.

These are presentation concerns. They are not accepted answers or durable gameplay state.

### Svelte must never own

- accepted classify mapping;
- accepted total order;
- accepted threshold selections;
- threshold source-independence truth;
- threshold eligibility/capability/procedure evaluation;
- board-completion truth;
- story reveals or durable completion;
- hidden future board availability.

The frontend never imports compiler Analysis definitions and never serializes hidden answer fields.

## 5. Frontend public contract

HPA-261 mirrors HPA-260's answer-key-free JSON in `apps/game/src/lib/state/types.ts`. The exact names should follow the Rust wire when HPA-260 lands, but the required shape is:

```ts
export type AnalysisActionToken = {
  sceneId: string;
  activeBoardId: string | null;
  durableRevision: number;
};

export type AnalysisDraft =
  | { kind: "classify"; groupByCard: Record<string, string> }
  | { kind: "order"; cardIds: string[] }
  | { kind: "threshold"; selectedCardIds: string[] };

export type AnalysisFeedbackView = {
  kind: "incomplete" | "incorrect";
  message: string;
} | null;

export type AnalysisCardView = {
  id: string;
  label: string;
  summary: string;
  source: InventoryTarget;
};

export type AnalysisGroupView = {
  id: string;
  label: string;
  description: string;
};

export type AnalysisFixedAnchorView = {
  cardId: string;
  position: number;
};
```

Each board variant exposes only its public presentation metadata and current draft:

```ts
export type AnalysisBoardView =
  | {
      kind: "classify";
      id: string;
      label: string;
      prompt: string;
      cards: AnalysisCardView[];
      groups: AnalysisGroupView[];
      draft: Extract<AnalysisDraft, { kind: "classify" }>;
      completed: boolean;
      readOnly: boolean;
      feedback: AnalysisFeedbackView;
      hint: string | null;
    }
  | {
      kind: "order";
      id: string;
      label: string;
      prompt: string;
      cards: AnalysisCardView[];
      fixedAnchors: AnalysisFixedAnchorView[];
      draft: Extract<AnalysisDraft, { kind: "order" }>;
      completed: boolean;
      readOnly: boolean;
      feedback: AnalysisFeedbackView;
      hint: string | null;
    }
  | {
      kind: "threshold";
      id: string;
      label: string;
      prompt: string;
      cards: AnalysisCardView[];
      minimumSelected: number;
      draft: Extract<AnalysisDraft, { kind: "threshold" }>;
      completed: boolean;
      readOnly: boolean;
      feedback: AnalysisFeedbackView;
      hint: string | null;
    };
```

`Mode` carries the active Analysis board/action token plus the existing visual/audio cue. `SceneView::Analysis` contains only the boards Rust currently exposes to the player. HPA-261 does not synthesize locked future boards.

If HPA-260 lands with a slightly different JSON field name, HPA-261 follows the Rust serialization rather than introducing a frontend adapter DTO family.

## 6. Component structure

Create the workbench under one feature folder:

```text
apps/game/src/lib/components/analysis/
  AnalysisWorkbench.svelte
  AnalysisCard.svelte
  ClassifyBoard.svelte
  OrderBoard.svelte
  ThresholdBoard.svelte
```

Do not create a design-system package or a `boardRenderers` registry.

### `AnalysisWorkbench`

Owns common presentation only:

- board navigation/progress;
- active board title and prompt;
- board-kind dispatch;
- one-step Undo snapshot;
- Reset;
- optional Hint disclosure;
- minimal feedback region;
- Submit;
- shared focus-return behavior;
- solved-board read-only chrome.

### `AnalysisCard`

A small presentation primitive for a card label/summary and optional public badges. It does not know the board solution or call Tauri commands.

### Board components

Each board component:

- receives one public board view;
- derives a replacement `AnalysisDraft` from a pointer/keyboard action;
- emits that full replacement draft to `AnalysisWorkbench`;
- has no backend knowledge and no correctness logic.

## 7. Workbench layout

At 1280×720, use a contained workbench rather than relying on page-height growth:

- width around `min(1100px, calc(100vw - 48px))`;
- height bounded by the current viewport below the `GameShell` chapter header;
- grid rows: workbench header, scrollable board body, feedback/actions footer;
- board body owns vertical overflow;
- existing theme variables (`--bone`, `--char`, `--rule-strong`, `--crimson`, `--cyan`, etc.) provide the visual language.

Do not add a chapter-specific skin or animation system.

### Header

The header contains:

- a small `ANALYSIS` marker;
- board progress such as `2 / 3` based only on currently exposed boards;
- board label;
- authored prompt;
- a compact board navigation list showing visible/completed/current state;
- a Back control that selects the previous visible board through Rust.

Board navigation never predicts or displays a board not present in the Rust view.

### Footer

The footer contains:

- feedback region;
- optional Hint disclosure when `hint !== null`;
- Undo when a presentation-only previous draft exists;
- Reset when the active board is editable and non-empty;
- Submit whenever the board is editable.

Do **not** disable Submit merely because the frontend believes the draft is incomplete. Incomplete submission is Rust-owned gameplay feedback and must remain testable.

Completed/read-only boards hide mutation/submit/undo/reset controls and display an explicit text state such as `完成・只讀檢視`.

## 8. Interaction model

All primary actions use native `<button>` controls. Pointer click and keyboard Enter/Space therefore execute the same handler and generate the same full replacement draft.

No drag-and-drop is required for Chapter 1.

### 8.1 Classify

Render:

- an unassigned card pool;
- one group panel per public `groups` entry;
- cards already assigned to each group;
- a temporary selected-card state in the component.

Interaction:

1. Activate a card in the pool or a group.
2. Activate a group's `放入此組` control to assign/move it.
3. Assigned cards expose `移除` to return them to the unassigned pool.
4. Clicking another group after selecting an assigned card moves it directly.

The emitted draft is only:

```ts
{ kind: "classify", groupByCard: nextMap }
```

The UI does not mark a group assignment correct/incorrect before Rust submission.

### 8.2 Order

Render a numbered list of authored positions plus a small unplaced-card pool.

Public fixed anchors are structural presentation rules, not answer-key data:

- a fixed anchor is rendered at its authored position as locked;
- it has no move/remove buttons;
- its card is not duplicated in the unplaced pool.

Movable interaction:

- `加入時間線` appends an unplaced card to the next open movable position;
- placed movable cards expose `上移`, `下移`, and `移除`;
- movement crosses only movable positions and never displaces a fixed anchor;
- all operations emit the whole order draft.

The workbench may materialize public fixed anchors into the replacement order when the first edit occurs. Reset may still send the Rust-defined empty order draft. This is mechanical use of public structure, not local correctness inference.

### 8.3 Threshold

Render every public card as a toggle button/checkbox-like control with `aria-pressed`.

Each card also shows public source/procedure badges by resolving `card.source` against the current `GameStateView.inventory`:

- source badge: prefer `sourceGroup.label`, then `provenance.sourceLabel`, then the existing `sourceKindLabels` mapping;
- procedure badge: existing `proceduralStatusLabels[record.provenance.proceduralStatus]` when non-null/non-unspecified.

Reuse the existing Case File label maps. Do not duplicate provenance vocabulary.

Show only mechanical progress:

> `已選 N / 最少 M`

The frontend must allow the player to select any displayed combination, including two records with the same source group. Rust/compiler semantics decide whether that combination is accepted.

## 9. Undo and Reset

HPA-261 needs Undo/Reset without creating a second durable draft model.

### One-step Undo

`AnalysisWorkbench` keeps at most one previous public draft for the current board.

Before sending an edit:

1. clone the current public draft;
2. send the replacement draft through `update_analysis_draft`;
3. only retain the clone as Undo state when the authoritative command response is accepted by the frontend response fence.

Undo sends the saved draft through the **same** `update_analysis_draft` command. It is not a local rollback.

Undo history is cleared on:

- board change;
- scene/session replacement;
- reset after successful response;
- solved/read-only transition.

It is intentionally not persisted.

### Reset

Reset sends the board-kind's empty typed draft:

```ts
{ kind: "classify", groupByCard: {} }
{ kind: "order", cardIds: [] }
{ kind: "threshold", selectedCardIds: [] }
```

Rust remains the authoritative post-reset view.

## 10. Command flow and stale-response safety

### No optimistic gameplay mutation

Board controls compute a candidate replacement draft, but the rendered board continues to come from `gameState.value`. After the command returns, the Rust response becomes the new view.

This keeps save state, correctness, and UI state aligned.

### Commands

Frontend wrappers mirror HPA-260:

```ts
selectAnalysisBoard(expected: AnalysisActionToken, boardId: string)
updateAnalysisDraft(expected: AnalysisActionToken, draft: AnalysisDraft)
submitAnalysisBoard(expected: AnalysisActionToken)
```

All three go through the existing gameplay command dispatcher so the global `gameState.inFlight` isolation still applies.

### Frontend response fence

Rust's `AnalysisActionToken` rejects stale commands at the authority boundary. HPA-261 still needs to stop a late successful response from an old frontend session from overwriting a newer `gameState.value`.

Add a narrow optional response guard to the existing dispatcher rather than another command client:

1. an Analysis wrapper captures `presentationState.sessionEpoch` and the current `AnalysisActionToken` before invoke;
2. after the async invoke returns but **before** `applyGameplayCommandResult`, the guard checks that:
   - the session epoch is unchanged;
   - the current mode is still `analysis`;
   - the current scene/action token still matches the captured expected token;
3. if the guard fails, discard the frontend response and do not overwrite the newer view.

The guard compares against the current pre-response token, not the token inside the returned state, because a successful command legitimately advances `durableRevision`.

Do not add an Analysis-owned generation counter. `presentationState.sessionEpoch`, the HPA-260 action token, and existing `gameState.inFlight` are sufficient.

## 11. Accessibility and focus contract

The first-version accessibility floor is structural, not decorative.

### Semantics

Use:

- `<nav>` / lists for board progress;
- headings for active board context;
- `<button>` for every mutation;
- `<ol>` for order slots;
- labelled group sections for classify groups;
- `aria-pressed` for threshold selection and temporary classify card selection;
- text labels for completion, fixed anchors, errors, and success state.

No outcome is communicated by color alone.

### Keyboard parity

Because pointer and keyboard activate the same native buttons:

- classify assignment/move/remove works without drag;
- order place/up/down/remove works without drag;
- threshold toggle works without drag;
- Undo/Reset/Submit/Back/Hint are ordinary buttons.

Do not add global arrow-key or Escape listeners for v1. That avoids colliding with `GameShell`'s existing global Escape owner and browser/native button behavior.

### Visible focus

Every interactive control must have an explicit `:focus-visible` treatment using existing palette variables.

### Focus return

Use stable `data-analysis-focus-key` attributes and local `tick()`-based focus restoration.

Required outcomes:

- Back/board selection -> focus active board heading after the authoritative board switch;
- classify assign/move/remove -> focus the same card in its new location;
- order move -> focus the moved card's corresponding action area;
- order/remove or threshold toggle -> focus the same card when it remains available;
- Reset -> focus the first editable card or board heading;
- failed Submit -> focus the feedback region (`tabindex="-1"`) after new feedback is rendered;
- correct Submit -> Rust switches to result dialogue; existing `DialogueBox` owns the next interaction;
- returning from the Escape menu remains owned by `GameShell` and requires no Analysis-specific code.

### Reduced motion

The MVP uses no essential card-flight or layout animation. If a small CSS transition is retained for hover/focus, disable nonessential transform/transition behavior under `@media (prefers-reduced-motion: reduce)`.

## 12. Existing system integration

### `GameShell`

Keep the current shell untouched unless a type exhaustiveness fix is required.

Analysis runs inside the existing `<main>` region, so it automatically inherits:

- chapter/objective chrome;
- menu inerting;
- Escape ownership;
- top-layer persistence behavior;
- gameplay-input isolation.

### Case File

`shouldShowCaseFile(mode)` already hides only `gameComplete`, so Analysis keeps the Case File available.

`canReexamineCaseRecords(mode)` already enables re-examination only in explore/interrogation. Analysis therefore shows records but does not launch re-examine dialogue. This is the intended first-version behavior; HPA-261 should not change it.

### Acquisition popup

Analysis cards reference already-acquired records. HPA-261 adds no acquisition behavior and does not touch acknowledgement flow.

### Dialogue

Intro/result/outro continue through existing `DialogueBox` and `advance_dialogue`. The workbench appears only when Rust projects `mode.type === "analysis"`.

### Audio

Add the three Analysis command names to the frontend `GameplayCommandName` union so they use the normal command pipeline. Do not add Analysis SFX assets or outcome sounds in HPA-261.

### Scene navigation

Add the `analysis` scene type label (`分析`) to `SceneNavigationPanel`; do not create a new scene-selection surface.

## 13. Typed fixture policy

HPA-261 needs deterministic component tests before HPA-260 is fully merged.

Add one answer-key-free frontend fixture based on the real HPA-259 Beat 8.5 IDs/labels:

- classify board: `evidence_packages`;
- order board: `local_event_sequence` with public fixed `event_1841` anchor;
- threshold board: `narrow_request_basis` with evidence/statement source refs;
- representative public inventory/provenance required to display source/procedure badges.

The fixture contains **no** accepted map/order/selections and no local `correct` flags.

A focused contract test must fail if Analysis frontend source/fixtures introduce hidden answer-key field names such as:

```text
acceptedGroupByCard
acceptedOrder
acceptedSelections
```

HPA-262 later replaces fixture-only confidence with real-runtime parity tests.

## 14. Testing strategy

### Contract/source tests

Pin:

- all three public board variants compile in TypeScript;
- fixture contains only answer-key-free public data;
- Analysis feature source contains no accepted-answer fields;
- command wrappers use action tokens and response guards.

### Component tests

Use Testing Library + `userEvent`/`fireEvent`.

For each interaction that matters, run both pointer and keyboard activation and assert the emitted replacement `AnalysisDraft` is identical.

#### Classify

- pool/group rendering;
- assign, move, remove;
- keyboard completion path;
- no local correctness markers.

#### Order

- fixed anchor is visibly locked and has no mutation controls;
- every movable card can be placed, moved, and removed;
- movement never displaces fixed anchors;
- keyboard completion path.

#### Threshold

- toggle selection;
- source/procedure badges render from public inventory;
- minimum count progress renders;
- same-source selections are not blocked locally;
- keyboard completion path.

#### Workbench

- board navigation/back uses semantic select command;
- one-step Undo sends the prior draft to Rust;
- Reset sends the empty typed draft;
- incomplete/incorrect feedback is textual and receives useful focus;
- optional hint is absent when null;
- completed board is read-only;
- command-disabled state prevents duplicate actions;
- session/token response fence discards stale returned state.

### Existing regression checks

- `SceneNavigationPanel` labels Analysis scenes;
- Case File remains available through existing mode rules;
- `GameShell` Escape/focus behavior is unchanged.

## 15. Scope and non-goals

Do not add:

- drag-and-drop dependency;
- generic graph/canvas/edge editing;
- compare/route/chain renderers;
- frontend evaluator or `isCorrect` helper;
- source-group distinctness checker;
- procedural eligibility checker;
- accepted answer fixtures;
- a second persistent or optimistic Analysis store;
- new save schema or frontend persistence layer;
- Analysis-specific global keyboard router;
- Chapter 2 UI;
- animation polish, chapter skinning, or release-level responsive matrix;
- controller-specific optimization beyond native keyboard-compatible controls.

## 16. Acceptance mapping

| HPA-261 acceptance requirement | Design owner |
|---|---|
| Keyboard-only completion for classify/order/threshold | Native-button board interaction models + component tests |
| Pointer/keyboard produce identical semantic commands | Same handlers emit full `AnalysisDraft`; parity tests |
| Fixed anchors cannot move | `OrderBoard` renders public fixed anchors as locked slots |
| Every required card predictable place/remove | Pool + explicit add/move/remove controls |
| Threshold exposes source/procedure data | Public source ref -> inventory resolution + reused Case File labels |
| No frontend correctness | Rust-owned public view, no accepted fields, source contract test |
| Completed boards reopen read-only | Rust `readOnly`/completion projection + workbench read-only branch |
| Feedback not color-only and useful focus return | text live region + explicit focus contract |
| Stale response cannot overwrite newer view | narrow dispatcher response guard using session epoch + action token |
| Preserve shell/Case File/audio/Escape/input isolation | reuse current page/GameShell/command pipeline; no global Analysis handlers |
| 1280×720 usable | bounded workbench with scrollable body and compact footer |
| Fixture parity with runtime | HPA-261 public fixture now; HPA-262 owns live parity acceptance |

## 17. Design self-review

- **Scope:** limited to Chapter 1's three committed board families and existing shell integration.
- **Ownership:** every correctness/durable rule remains compiler/Rust-owned.
- **Interaction:** all required actions have explicit non-drag pointer/keyboard paths.
- **Accessibility:** semantics and focus behavior are part of structure, not deferred styling.
- **Merge risk:** PR #44 overlap is resolved through one documented replacement path rather than parallel UI stacks.
- **Future work:** richer feedback, progressive hints, animation, later templates, controller polish, and broad hardening remain in their existing follow-up tickets.
