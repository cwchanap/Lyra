# HPA-261 Chapter 1 Analysis Workbench UI Design

**Date:** 2026-08-08  
**Status:** Revised against merged HPA-260 and implementation-risk review  
**Linear:** HPA-261  
**Baseline:** current `main` after merged PR #44 (HPA-561) and PR #47 (HPA-260)

## 1. Goal

Complete the Chapter 1 Analysis UI without rebuilding the runtime that is already merged.

The first version must:

- preserve the existing playable P1 threshold tutorial;
- make `classify`, `order`, and `threshold` boards usable with pointer and keyboard controls;
- keep Rust authoritative for availability, correctness, completion, feedback, story effects, and durable drafts;
- preserve the existing GameShell, Case File, dialogue, persistence overlays, audio routing, and Escape ownership;
- remain usable at 1280×720;
- preserve the packaged production-journey accessibility contract;
- avoid speculative Chapter 2 renderer/template infrastructure.

This is a focused Chapter 1 workbench completion/refactor, not a new Analysis platform.

## 2. Current repository baseline

### Already merged — reuse directly

HPA-260 now provides the complete mutable Analysis runtime and frontend wire:

- `AnalysisActionToken`;
- `AnalysisDraft` for classify/order/threshold;
- public `AnalysisCardSourceView`, including `practice`;
- `AnalysisBoardView` with cards, groups/fixed anchors/minimum selection, `available`, `completed`, `readOnly`, `draft`, `feedback`, and `hint`;
- Analysis `Mode` and `SceneView`;
- `select_analysis_board`, `update_analysis_draft`, and `submit_analysis_board`;
- TypeScript wrappers for those commands;
- `MUTATING_GAMEPLAY_COMMANDS` and the 17-member `GameplayCommandName` contract;
- Tauri command registration;
- exact Analysis save/restore and no-thumbnail autosave;
- Rust stale-action validation;
- Rust draft/card availability validation;
- Scene Select Analysis support and the `分析` label;
- the existing `+page.svelte` Analysis route.

HPA-261 must not recreate any of that.

### Existing playable surface — migrate, do not blindly delete

`AnalysisView.svelte` currently renders the P1 practice threshold board. Its tests already pin useful behavior:

- four `practice:` cards render;
- threshold cards toggle through the whole-draft command;
- authored wrong-choice feedback renders;
- unavailable/disabled/completed controls do not mutate;
- non-threshold boards currently show a placeholder.

HPA-261 replaces this component only after its useful P1 tests have been migrated and the packaged production journey passes through the new workbench.

## 3. Chosen architecture

Use one common host plus three focused board components:

```text
AnalysisWorkbench
  ├─ ClassifyBoard
  ├─ OrderBoard
  └─ ThresholdBoard
       └─ AnalysisCard
```

Supporting pure modules:

```text
src/lib/analysis/
  test-fixtures.ts
  analysis-boundary.test.ts
  order-draft.ts
  order-draft.test.ts

src/lib/case-file/
  provenance-badges.ts
  provenance-badges.test.ts
```

### Why this shape

The three board families have materially different interaction models, but share navigation, feedback, Undo/Reset/Submit, and focus behavior. One host plus three small components keeps those concerns separate without introducing a renderer registry.

### Explicitly rejected

Do not add:

- drag-and-drop;
- a graph/canvas system;
- generic board-renderer/plugin registries;
- compare/route/chain support;
- a second frontend Analysis store;
- a second command dispatcher/generation counter;
- a generic sparse-anchor editor.

## 4. Ownership boundary

### Rust owns

- board availability and completion;
- card availability;
- stored active-board identity;
- current durable draft;
- accepted solutions and correctness;
- threshold source/procedure/capability truth;
- failure feedback;
- story reveals and objective progress;
- persistence and revisioning.

### Svelte may own presentation mechanics only

- temporary classify card selection;
- structural order manipulation over public draft/anchors;
- threshold toggle presentation;
- one previous public draft for one-step Undo;
- hint-expanded state;
- focus-return bookkeeping.

### Svelte must never own

- accepted group mapping;
- accepted final order;
- accepted threshold subsets;
- source-group independence evaluation;
- procedural/proof eligibility evaluation;
- hidden future-board availability;
- durable reveal logic.

## 5. Display board vs mutation board

The implemented runtime deliberately exposes two related concepts.

### `mode.boardId` — display board

Rust may render `mode.boardId` from the stored active board **or** fall back to the next available incomplete board when the stored active board is absent/unavailable.

The workbench renders `mode.boardId`.

### `mode.activeBoardId` / `mode.actionToken.activeBoardId` — mutation fence

Rust update/submit commands mutate `scene.active_board_id`. If it is `None`, they return `analysisNoActiveBoard`; if the expected token no longer matches, they reject the stale action.

Therefore the UI must not assume that a displayed fallback board is already active.

### Required reconciliation before mutation

Before any draft update, Reset, Undo, or Submit:

1. compare `mode.activeBoardId` with `mode.boardId`;
2. if equal, use `mode.actionToken` directly;
3. if different, call `selectAnalysisBoard(mode.actionToken, mode.boardId)` first;
4. require a non-null returned Analysis state whose active board is now `mode.boardId`;
5. use the **returned state's fresh action token** for the intended mutation;
6. if selection fails/returns null/wrong mode, abort the second mutation and leave the authoritative UI/error surface unchanged.

Board-navigation clicks are already explicit selection actions and need no second selection.

This keeps the runtime's distinction instead of collapsing the two fields or sending a mutation against the wrong active board.

## 6. Command flow and one-step Undo

The current dispatcher already returns `GameStateView | null`; only the Analysis wrappers discard it.

HPA-261 makes the existing Analysis dispatch/wrappers return that already-applied state. It does not add another client or response fence.

### Draft edit

1. clone the current public draft;
2. reconcile the display board to the active board if needed;
3. send the complete replacement draft;
4. only if the authoritative update returns non-null, store the previous draft as the one Undo slot;
5. render the returned/global authoritative state.

### Undo

Undo sends the previous public draft through the same reconciled mutation path. It is never a local rollback and is not persisted.

### Reset

Reset sends the empty draft for the board kind:

```ts
{ kind: "classify", groupByCard: {} }
{ kind: "order", cardIds: [] }
{ kind: "threshold", selectedCardIds: [] }
```

### Submit

Submit remains available on editable boards even when the frontend can see an incomplete draft. Rust owns `Incomplete` feedback.

Completed/read-only boards expose no mutation/Undo/Reset/Submit controls.

## 7. Board interaction contracts

### 7.1 Classify

Render:

- an unassigned card pool;
- one group panel per public group;
- assigned cards inside their group;
- explicit group-assignment and removal buttons.

Interaction:

1. activate an available card;
2. activate `放入「<group>」` to assign/move it;
3. assigned cards expose `移除`.

Emit the complete public draft:

```ts
{ kind: "classify", groupByCard: nextMap }
```

Unavailable cards remain visible but cannot be assigned. Read-only boards expose no mutation controls.

### 7.2 Order

The first-version UI supports **contiguous prefix anchors only**. The current compiler fixture uses exactly:

```text
event_1841@1
```

#### Build-time contract

Current compiler validation permits sparse anchors such as one fixed card at position 3. That is incompatible with the deliberately small prefix-only UI.

HPA-261 therefore adds one compiler diagnostic:

```text
analysisOrderAnchorNotPrefix
```

After existing anchor validity/duplicate/accepted-order checks succeed, non-empty fixed-anchor positions must sort to exactly `1..N`. `[]` remains valid.

This makes unsupported authoring fail during scene compilation instead of throwing inside Svelte. A future sparse-anchor product requirement must expand compiler + UI together.

#### Defensive UI contract

`order-draft.ts` still validates the public anchor shape defensively. It never throws into rendering. If a stale/invalid public view contains a non-prefix shape, `OrderBoard` renders an explicit configuration-error state and exposes no mutation controls.

#### Fixed-anchor availability

Rust rejects any draft containing an unavailable evidence/statement card. Therefore the UI must not force-materialize an unavailable fixed anchor.

If any fixed-prefix card has `card.available === false`:

- show `尚未取得固定卡，暫時無法編排時間線。`;
- do not materialize that anchor;
- disable add/move/remove order controls;
- keep the current authoritative draft visible;
- Reset may still send the Rust-valid empty draft.

When all fixed-prefix cards are available, edits materialize the prefix and movable cards can be added/moved/removed without crossing it.

Movable unavailable cards cannot be added.

### 7.3 Threshold

Threshold renders every public card as an ordinary toggle. It never evaluates same-source independence or provenance eligibility locally.

Selection is always emitted deterministically:

```ts
selectedCardIds: [...selected].sort()
```

Two cards from the same source group remain selectable together; Rust decides whether the submission is accepted.

#### Practice cards

`practice:` cards are self-contained tutorial cards and do not resolve through Case File inventory. They show their authored card label/summary only.

The current P1 tutorial must keep working unchanged.

#### Real evidence/statement provenance

Beat 8.5 threshold reasoning depends on source groups, procedure, and proof capabilities. Do not invent a second Analysis vocabulary.

Extract the existing Case File provenance-label derivation into:

```text
$lib/case-file/provenance-badges.ts
```

The pure helper receives an `EvidenceRecord | StatementRecord` and derives the same presentation strings currently used by `CaseFileRecordDetail`:

- `來源類型`;
- `呈現層`;
- `程序狀態`;
- `完整度`;
- `可信度`;
- `來源` (`provenance.sourceLabel ?? sourceGroup?.label`);
- optional `來源群組` using the current Case File condition;
- source-group summary;
- `可證明` from `proofCapabilities`.

`CaseFileRecordDetail` must consume that helper without visible behavior changes; its existing tests pin the output. `ThresholdBoard` consumes the same helper for real evidence/statement cards and displays the reasoning-relevant subset:

- `來源類型`;
- `程序狀態`;
- `來源`;
- optional `來源群組`;
- `可證明`.

Important naming distinction:

- `AnalysisCardView.sourceLabel` is the Analysis card's public source display label projected by Rust (evidence name / statement speaker);
- `CaseRecordProvenance.sourceLabel` is provenance source text.

Provenance badges must use the **resolved inventory record's `record.provenance.sourceLabel`**, not `card.sourceLabel`.

## 8. Public fixtures and shipped content

The current `analysis_scene_8_5.md` under `packages/scripts/__fixtures__/analysis-chapter-1/` is a **compiler/runtime contract fixture**, not shipped Chapter 1 content.

HPA-261 uses its public IDs/shapes only to exercise classify/order/threshold UI:

```text
evidence_packages
local_event_sequence
narrow_request_basis
```

Name frontend fixtures accordingly (for example `beat85CompilerFixture`) and never describe those IDs as already-shipped production content.

Production Beat 8.5 authoring is owned by **HPA-265**, which will replace the current linear Beat 8.5 transition with `docs/stories_plan/chapter_1/analysis_scene_8_5.md`. HPA-262 owns cross-layer integration/acceptance. HPA-261 does not author the scene.

## 9. Test fixture reuse and answer-key guard

Frontend inventory fixtures must reuse:

```text
neutralCaseRecordProvenance
neutralEvidenceRecordView
neutralStatementRecordView
```

from `src/lib/state/test-fixtures.ts`, then override only provenance/source-group fields required by the test.

The answer-key ownership guard must fail closed:

- no `try/catch` that silently skips missing feature files;
- resolve feature files relative to `import.meta.url`;
- after all components exist, read every declared Analysis feature file and assert all were read;
- scan for `acceptedGroupByCard`, `acceptedOrder`, and `acceptedSelections`;
- fixture serialization must also omit those fields.

The full source scan belongs in final acceptance after the files actually exist; Task 1 only guards the fixture itself.

## 10. Focus and accessibility

Use native buttons/lists/groups and visible focus styles. Pointer click and keyboard Enter/Space execute the same handlers. Escape remains owned by `GameShell`.

### Reuse the existing focus-return pattern

Follow `CaseFilePanel.svelte` rather than inventing a second focus system:

1. `tick()` after authoritative rerender;
2. try a stable `data-*` focus key;
3. fall back to the active board heading.

Keep this logic local to the workbench. Do not extract a generic focus utility unless a third consumer appears.

Stable keys may include:

```text
card:<cardId>
group:<groupId>
board:<boardId>
submit
reset
undo
hint
```

After incomplete/incorrect submit, focus the feedback region (`role="status"`, `tabindex="-1"`).

After board switch, clear Undo/hint and focus the new board heading.

Tests must source-assert the required `:focus-visible` and `prefers-reduced-motion: reduce` styles, following the existing AcquisitionPopup test convention.

## 11. Packaged production-journey contract

Production UI coupling is explicitly centralized in:

```text
apps/game/e2e-tauri/production-anchors.ts
```

The current P1 production journey depends on:

- a workbench root matching `aria-label="分析板"`;
- the existing four P1 card accessible names;
- a submit button named `比對推論`.

HPA-261 preserves those contracts unless a deliberate copy change also updates the production anchors and helper in the same task.

`check:e2e` only type-checks the E2E code; it does not prove selectors still work. Before deleting the old `AnalysisView`, run the real packaged `production-journey` suite against the new routed workbench.

`production-anchors.ts` and its helper are otherwise reuse-only.

## 12. Case File and shell behavior

No `GameShell.svelte` behavior change is required.

Current helpers already give the desired Analysis behavior:

- Case File visible;
- re-examination disabled outside Explore/Interrogation.

Add one Analysis mode regression test, but do not add a new mode rule.

## 13. Risks and stop conditions

### Risk A — P1 packaged journey breaks on UI refactor

**Mitigation:** preserve `分析板` / card names / `比對推論`; run the real `production-journey` suite before deleting the old component.

### Risk B — displayed fallback board is not active for mutation

**Mitigation:** reconcile with `selectAnalysisBoard` before every mutation and use the returned fresh token. Abort the second command on null/error/wrong-mode response.

### Risk C — authored sparse anchors pass compiler but UI only supports prefix anchors

**Mitigation:** add `analysisOrderAnchorNotPrefix` to compiler validation and keep the UI defensive rather than throwing.

### Risk D — required fixed anchor is unavailable

**Mitigation:** never force-materialize an unavailable card; show an explicit blocked-order state until the fixed prefix is available.

### Risk E — Analysis provenance copy drifts from Case File

**Mitigation:** extract one pure provenance-label helper and keep existing Case File rendering tests green.

### Risk F — compiler fixture is mistaken for shipped Chapter 1 content

**Mitigation:** name it as a compiler fixture; HPA-265 remains the production authoring owner.

## 14. HPA-261 acceptance boundary

HPA-261 is complete when:

- P1 practice threshold behavior still works;
- classify/order/threshold components are keyboard/pointer playable against public fixtures;
- fallback display-board reconciliation is covered;
- unavailable cards/anchors never produce knowingly invalid frontend drafts;
- prefix-only order authoring fails at compile time when violated;
- threshold shows source/procedure/proof data with Case File vocabulary;
- completed boards are read-only;
- one-step Undo/Reset use authoritative updates;
- answer-key source scan fails closed;
- Case File behavior is pinned;
- the packaged P1 production journey passes through the new workbench.

HPA-261 does **not** need the final production Beat 8.5 scene to be authored.

## 15. Handoff

### HPA-262 — cross-layer integration/acceptance

Prove against the integrated real content/runtime:

- final TypeScript/Rust public field parity;
- real board command payloads;
- representative save/title/Continue draft restore for each board;
- completed-board read-only reopen;
- correct submission effects/dialogue exactly once;
- packaged keyboard path through the real three-board scene.

### HPA-265 — production story/content owner

Author and iterate the real `docs/stories_plan/chapter_1/analysis_scene_8_5.md`, replacing the existing linear Beat 8.5 transition while preserving Chapter 1 canon/proof order.

## 16. Deferred / non-goals

- progressive contextual feedback/hints (HPA-263);
- Chapter 2 compare/route/chain templates;
- sparse fixed-anchor editing;
- drag-and-drop/controller-specific polish;
- animation polish beyond reduced-motion compliance;
- generic renderer/template registries;
- save migrations;
- broader Case File redesign;
- production Beat 8.5 authoring itself.
