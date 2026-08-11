<script lang="ts">
  import { tick } from "svelte";
  import type {
    AnalysisActionToken,
    AnalysisBoardView,
    AnalysisDraft,
    AnalysisFeedbackView,
    GameStateView,
    Inventory,
    Mode,
    SceneView,
  } from "$lib/state/types";
  import ClassifyBoard from "./ClassifyBoard.svelte";
  import OrderBoard from "./OrderBoard.svelte";
  import ThresholdBoard from "./ThresholdBoard.svelte";

  type AnalysisSceneView = Extract<SceneView, { kind: "analysis" }>;
  type AnalysisModeView = Extract<Mode, { type: "analysis" }>;

  let {
    scene,
    mode,
    inventory,
    onSelectBoard,
    onUpdateDraft,
    onSubmit,
    disabled = false,
  }: {
    scene: SceneView;
    mode: Mode;
    inventory: Inventory;
    onSelectBoard: (
      actionToken: AnalysisActionToken,
      boardId: string,
    ) => Promise<GameStateView | null>;
    onUpdateDraft: (
      actionToken: AnalysisActionToken,
      draft: AnalysisDraft,
    ) => Promise<GameStateView | null>;
    onSubmit: (
      actionToken: AnalysisActionToken,
    ) => Promise<GameStateView | null>;
    disabled?: boolean;
  } = $props();

  let workbenchElement = $state<HTMLElement>();
  let feedbackElement = $state<HTMLElement>();
  let undoDraft = $state<AnalysisDraft | null>(null);
  let undoBoardId = $state<string | null>(null);
  let hintOpen = $state(false);
  let observedBoardId = $state<string | null>(null);
  let focusFeedbackOnRender = $state(false);
  let mutationError = $state<string | null>(null);

  let analysis = $derived(
    scene.kind === "analysis" ? (scene as AnalysisSceneView) : null,
  );
  let analysisMode = $derived(
    mode.type === "analysis" ? (mode as AnalysisModeView) : null,
  );
  let board = $derived(
    analysis?.visibleBoards.find(
      (candidate) => candidate.id === analysisMode?.boardId,
    ) ?? null,
  );
  let boardFeedback = $derived<AnalysisFeedbackView | null>(
    analysisMode?.feedback ?? board?.feedback ?? null,
  );
  let boardReadOnly = $derived(
    board === null || !board.available || board.completed || board.readOnly,
  );
  let boardForRender = $derived<AnalysisBoardView | null>(
    board === null || hintOpen || board.hint === null
      ? board
      : { ...board, hint: null },
  );
  let navigationBoards = $derived(
    (analysis?.visibleBoards ?? []).filter((candidate) =>
      analysisMode?.availableBoardIds.includes(candidate.id),
    ),
  );
  let canUndo = $derived(
    !boardReadOnly &&
      undoDraft !== null &&
      undoBoardId === board?.id &&
      !disabled,
  );

  // The display board can change when the runtime falls back to a different
  // incomplete board. Clear presentation-only state only after an explicit
  // board change; mounting the workbench must never issue a selection command.
  $effect(() => {
    const nextBoardId = analysisMode?.boardId ?? null;
    if (observedBoardId === null) {
      observedBoardId = nextBoardId;
      return;
    }
    if (nextBoardId === observedBoardId) return;
    observedBoardId = nextBoardId;
    undoDraft = null;
    undoBoardId = null;
    hintOpen = false;
    focusFeedbackOnRender = false;
    mutationError = null;
    if (nextBoardId !== null) {
      void focusAfterRender(`board:${nextBoardId}`);
    }
  });

  $effect(() => {
    if (!focusFeedbackOnRender || boardFeedback === null) return;
    focusFeedbackOnRender = false;
    void focusAfterRender("feedback");
  });

  function cloneDraft(draft: AnalysisDraft): AnalysisDraft {
    switch (draft.kind) {
      case "classify":
        return { kind: "classify", groupByCard: { ...draft.groupByCard } };
      case "order":
        return { kind: "order", cardIds: [...draft.cardIds] };
      case "threshold":
        return {
          kind: "threshold",
          selectedCardIds: [...draft.selectedCardIds],
        };
    }
  }

  function emptyDraft(kind: AnalysisBoardView["kind"]): AnalysisDraft {
    switch (kind) {
      case "classify":
        return { kind: "classify", groupByCard: {} };
      case "order":
        return { kind: "order", cardIds: [] };
      case "threshold":
        return { kind: "threshold", selectedCardIds: [] };
    }
  }

  function focusTarget(key: string): HTMLElement | null {
    const targets = workbenchElement?.querySelectorAll<HTMLElement>(
      "[data-analysis-focus-key]",
    );
    if (!targets) return null;
    for (const target of targets) {
      if (target.dataset.analysisFocusKey === key) return target;
    }
    return null;
  }

  async function focusAfterRender(key: string): Promise<void> {
    await tick();
    const target = focusTarget(key);
    if (target) {
      target.focus();
      return;
    }
    const fallback = focusTarget(
      board?.id === undefined ? "" : `board:${board.id}`,
    );
    fallback?.focus();
  }

  async function tokenForDisplayedBoard(): Promise<AnalysisActionToken | null> {
    const currentMode = analysisMode;
    const displayedBoard = board;
    if (!currentMode || !displayedBoard) return null;
    if (currentMode.activeBoardId === currentMode.boardId) {
      return currentMode.actionToken;
    }

    let selected: GameStateView | null;
    try {
      selected = await onSelectBoard(
        currentMode.actionToken,
        currentMode.boardId,
      );
    } catch {
      return null;
    }
    if (
      selected?.mode.type !== "analysis" ||
      selected.mode.boardId !== currentMode.boardId ||
      selected.mode.activeBoardId !== currentMode.boardId
    ) {
      return null;
    }
    return selected.mode.actionToken;
  }

  function mutationErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message) return error.message;
    return "更新草稿時發生錯誤，請再試一次。";
  }

  async function mutateDraft(
    nextDraft: AnalysisDraft,
    focusKey: string,
    options: { recordUndo?: boolean } = {},
  ): Promise<void> {
    const displayedBoard = board;
    if (!displayedBoard || boardReadOnly || disabled) return;
    const previousDraft = cloneDraft(displayedBoard.draft);
    const token = await tokenForDisplayedBoard();
    if (!token) {
      throw new Error("無法取得操作權限，請再試一次。");
    }

    let applied: GameStateView | null;
    try {
      applied = await onUpdateDraft(token, cloneDraft(nextDraft));
    } catch (error) {
      throw new Error(mutationErrorMessage(error), { cause: error });
    }
    if (applied === null) {
      throw new Error("草稿未被接受，請再試一次。");
    }

    if (options.recordUndo !== false) {
      undoDraft = previousDraft;
      undoBoardId = displayedBoard.id;
    } else {
      undoDraft = null;
      undoBoardId = null;
    }
    await focusAfterRender(focusKey);
  }

  async function handleDraft(
    draft: AnalysisDraft,
    focusKey: string,
  ): Promise<void> {
    mutationError = null;
    try {
      await mutateDraft(draft, focusKey);
    } catch (error) {
      mutationError = mutationErrorMessage(error);
      throw error;
    }
  }

  async function resetDraft(): Promise<void> {
    mutationError = null;
    const displayedBoard = board;
    if (!displayedBoard) return;
    try {
      await mutateDraft(emptyDraft(displayedBoard.kind), "reset");
    } catch (error) {
      mutationError = mutationErrorMessage(error);
    }
  }

  async function undo(): Promise<void> {
    if (!canUndo || undoDraft === null) return;
    mutationError = null;
    try {
      await mutateDraft(undoDraft, "undo", { recordUndo: false });
    } catch (error) {
      mutationError = mutationErrorMessage(error);
    }
  }

  async function submit(): Promise<void> {
    const currentMode = analysisMode;
    if (!currentMode || !board || boardReadOnly || disabled) return;
    const token = await tokenForDisplayedBoard();
    if (!token) return;

    let applied: GameStateView | null;
    try {
      applied = await onSubmit(token);
    } catch {
      return;
    }
    if (applied === null) return;

    const returnedFeedback =
      applied.mode.type === "analysis" ? applied.mode.feedback : null;
    if (returnedFeedback !== null) {
      focusFeedbackOnRender = true;
      await focusAfterRender("feedback");
    } else {
      await focusAfterRender("submit");
    }
  }

  async function selectBoard(boardId: string): Promise<void> {
    const currentMode = analysisMode;
    if (!currentMode || disabled) return;
    let selected: GameStateView | null;
    try {
      selected = await onSelectBoard(currentMode.actionToken, boardId);
    } catch {
      return;
    }
    if (
      selected?.mode.type !== "analysis" ||
      selected.mode.boardId !== boardId
    ) {
      return;
    }
    undoDraft = null;
    undoBoardId = null;
    hintOpen = false;
    await focusAfterRender(`board:${boardId}`);
  }

  async function selectRelative(offset: -1 | 1): Promise<void> {
    const currentBoardId = analysisMode?.boardId;
    if (!currentBoardId) return;
    const index = navigationBoards.findIndex(
      (candidate) => candidate.id === currentBoardId,
    );
    const next = navigationBoards[index + offset];
    if (next) await selectBoard(next.id);
  }

  async function toggleHint(): Promise<void> {
    if (!board?.hint || boardReadOnly) return;
    hintOpen = !hintOpen;
    await focusAfterRender("hint");
  }
</script>

<section
  bind:this={workbenchElement}
  class="analysis-workbench"
  aria-label="分析板"
>
  {#if analysis && analysisMode}
    <header class="workbench-header">
      <p class="eyebrow">分析工作台</p>
      <h1>{analysis.title}</h1>
      <p>{analysis.summary}</p>
    </header>

    {#if navigationBoards.length > 1}
      <nav class="board-navigation" aria-label="分析板導覽">
        <button
          type="button"
          disabled={disabled ||
            navigationBoards[0]?.id === analysisMode.boardId}
          onclick={() => selectRelative(-1)}
        >
          上一板
        </button>
        {#each navigationBoards as candidate (candidate.id)}
          <button
            type="button"
            aria-current={candidate.id === analysisMode.boardId
              ? "page"
              : undefined}
            disabled={disabled || candidate.id === analysisMode.boardId}
            data-analysis-board-id={candidate.id}
            onclick={() => selectBoard(candidate.id)}
          >
            {candidate.label}
          </button>
        {/each}
        <button
          type="button"
          disabled={disabled ||
            navigationBoards.at(-1)?.id === analysisMode.boardId}
          onclick={() => selectRelative(1)}
        >
          下一板
        </button>
      </nav>
    {/if}

    {#if boardForRender}
      {#if boardForRender.hint !== null || board?.hint !== null}
        <button
          type="button"
          class="hint-toggle"
          data-analysis-focus-key="hint"
          disabled={boardReadOnly || disabled}
          aria-expanded={hintOpen}
          onclick={toggleHint}
        >
          {hintOpen ? "隱藏提示" : "顯示提示"}
        </button>
      {/if}

      {#if boardForRender.completed || boardForRender.readOnly}
        <p class="read-only" role="status">完成・只讀檢視</p>
      {/if}

      {#if boardForRender.kind === "classify"}
        <ClassifyBoard
          board={boardForRender}
          headingFocusKey={`board:${boardForRender.id}`}
          onDraft={handleDraft}
          {disabled}
          readOnly={boardReadOnly}
        />
      {:else if boardForRender.kind === "order"}
        <OrderBoard
          board={boardForRender}
          headingFocusKey={`board:${boardForRender.id}`}
          onDraft={handleDraft}
          {disabled}
          readOnly={boardReadOnly}
        />
      {:else}
        <ThresholdBoard
          board={boardForRender}
          {inventory}
          headingFocusKey={`board:${boardForRender.id}`}
          onDraft={handleDraft}
          {disabled}
          readOnly={boardReadOnly}
        />
      {/if}

      {#if boardFeedback}
        <p
          bind:this={feedbackElement}
          class="feedback"
          role="status"
          tabindex="-1"
          data-analysis-focus-key="feedback"
        >
          {boardFeedback.message}
        </p>
      {/if}

      {#if mutationError}
        <p class="feedback" role="alert">{mutationError}</p>
      {/if}

      {#if !boardReadOnly}
        <footer class="workbench-actions" aria-label="分析操作">
          {#if canUndo}
            <button
              type="button"
              data-analysis-focus-key="undo"
              {disabled}
              onclick={undo}
            >
              復原
            </button>
          {/if}
          <button
            type="button"
            data-analysis-focus-key="reset"
            {disabled}
            onclick={resetDraft}
          >
            重設
          </button>
          <button
            type="button"
            class="submit"
            data-analysis-focus-key="submit"
            {disabled}
            onclick={submit}
          >
            比對推論
          </button>
        </footer>
      {/if}
    {:else}
      <p class="feedback" role="status">分析板載入中。</p>
    {/if}
  {:else}
    <p class="feedback" role="status">分析板載入中。</p>
  {/if}
</section>

<style>
  .analysis-workbench {
    display: grid;
    gap: 1rem;
    width: min(1040px, calc(100vw - 2rem));
    margin: 2rem auto 4rem;
    color: #efedf0;
  }

  .workbench-header {
    display: grid;
    gap: 0.35rem;
    padding: 0.25rem 0.25rem 0;
  }

  .workbench-header h1,
  .workbench-header p {
    margin: 0;
  }

  .workbench-header p:last-child {
    color: #c9cbd1;
    line-height: 1.6;
  }

  .eyebrow {
    color: #9cb6df;
    font-size: 0.82rem;
    letter-spacing: 0.13em;
  }

  .board-navigation,
  .workbench-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.55rem;
  }

  .board-navigation {
    padding: 0.75rem;
    background: rgba(16, 20, 29, 0.82);
    border: 1px solid rgba(179, 191, 214, 0.28);
  }

  .board-navigation button,
  .workbench-actions button,
  .hint-toggle {
    padding: 0.58rem 0.85rem;
    color: #d6e5ff;
    font: inherit;
    background: rgba(91, 135, 210, 0.14);
    border: 1px solid rgba(168, 200, 255, 0.4);
    cursor: pointer;
  }

  .board-navigation button[aria-current="page"] {
    color: #11151c;
    background: #b9cef1;
  }

  .hint-toggle {
    justify-self: start;
    color: #f2d1b2;
    background: rgba(154, 104, 61, 0.16);
    border-color: rgba(226, 173, 105, 0.42);
  }

  .workbench-actions {
    justify-content: flex-end;
    padding: 0.85rem;
    background: rgba(16, 20, 29, 0.95);
    border: 1px solid rgba(179, 191, 214, 0.3);
  }

  .workbench-actions .submit {
    color: #11151c;
    font-weight: 700;
    background: #b9cef1;
  }

  .board-navigation button:focus-visible,
  .workbench-actions button:focus-visible,
  .hint-toggle:focus-visible,
  [data-analysis-focus-key="feedback"]:focus-visible {
    outline: 3px solid #e2ad69;
    outline-offset: 3px;
  }

  .board-navigation button:disabled,
  .workbench-actions button:disabled,
  .hint-toggle:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .read-only,
  .feedback {
    margin: 0;
    padding: 0.85rem 1rem;
    background: rgba(154, 104, 61, 0.25);
    border-left: 3px solid #e2ad69;
  }

  .feedback {
    color: #f2d1b2;
  }

  @media (prefers-reduced-motion: reduce) {
    .analysis-workbench button {
      transition: none;
    }
  }
</style>
