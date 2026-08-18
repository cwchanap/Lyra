<script lang="ts">
  import { tick } from "svelte";
  import {
    analysisBoardProgress,
    analysisOverallProgress,
  } from "$lib/analysis/presentation";
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
  type AnalysisBoardState = "active" | "available" | "completed" | "locked";

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

  // A mutation aborted because the callback returned null (the shared game
  // client already surfaced the failure via gameState.error / ErrorBanner).
  // This must still throw so ClassifyBoard can preserve retry selection, but
  // must not populate the component-local mutationError — that would duplicate
  // the authoritative alert. See design §5 "Required reconciliation before
  // mutation", step 6: "leave the authoritative UI/error surface unchanged".
  class MutationAborted extends Error {
    readonly aborted = true;
    constructor(message: string) {
      super(message);
      this.name = "MutationAborted";
    }
  }

  let workbenchElement = $state<HTMLElement>();
  let feedbackElement = $state<HTMLElement>();
  let undoDraft = $state<AnalysisDraft | null>(null);
  let undoBoardId = $state<string | null>(null);
  let hintOpen = $state(false);
  let observedBoardId = $state<string | null>(null);
  let focusFeedbackOnRender = $state(false);
  let mutationError = $state<string | null>(null);
  let mutationInFlight = $state(false);

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
  let railBoards = $derived(
    analysis
      ? [...analysis.visibleBoards].sort(
          (left, right) =>
            boardStateOrder(left) - boardStateOrder(right) ||
            analysis.visibleBoards.indexOf(left) -
              analysis.visibleBoards.indexOf(right),
        )
      : [],
  );
  let navigationBoards = $derived(
    analysis
      ? analysis.visibleBoards.filter(
          (candidate) => candidate.available || candidate.completed,
        )
      : [],
  );
  let overallProgress = $derived(
    /* v8 ignore next -- lazy: only read inside the {#if analysis && analysisMode} block, so the null branch is never evaluated */
    analysisOverallProgress(analysis?.visibleBoards ?? []),
  );
  let canUndo = $derived(
    !boardReadOnly &&
      undoDraft !== null &&
      undoBoardId === board?.id &&
      !disabled,
  );

  function boardState(candidate: AnalysisBoardView): AnalysisBoardState {
    if (candidate.completed) return "completed";
    if (candidate.id === analysisMode?.boardId && candidate.available) {
      return "active";
    }
    if (candidate.available) return "available";
    return "locked";
  }

  function boardStateOrder(candidate: AnalysisBoardView): number {
    switch (boardState(candidate)) {
      case "completed":
        return 0;
      case "active":
        return 1;
      case "available":
        return 2;
      case "locked":
        return 3;
    }
  }

  function boardKindLabel(kind: AnalysisBoardView["kind"]): string {
    switch (kind) {
      case "classify":
        return "證據分類";
      case "order":
        return "事件順序";
      case "threshold":
        return "證據門檻";
    }
  }

  function boardStateLabel(
    state: AnalysisBoardState,
    readOnly: boolean,
  ): string {
    switch (state) {
      case "completed":
        return "已完成";
      case "locked":
        return "尚未解鎖";
      case "active":
        return readOnly ? "只讀" : "目前";
      case "available":
        return readOnly ? "只讀" : "可進入";
    }
  }

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
    /* v8 ignore next -- unreachable: workbenchElement is bound to the mounted section */
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
      /* v8 ignore next -- unreachable: board.id is always defined when board exists */
      board?.id === undefined ? "" : `board:${board.id}`,
    );
    fallback?.focus();
  }

  async function tokenForDisplayedBoard(): Promise<AnalysisActionToken | null> {
    const currentMode = analysisMode;
    const displayedBoard = board;
    /* v8 ignore next -- unreachable: only called when board and analysisMode are non-null */
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
    /* v8 ignore next -- unreachable: mutateDraft is only called from editable board actions */
    if (!displayedBoard || boardReadOnly || disabled) return;
    /* v8 ignore next -- unreachable: handleDraft already checks mutationInFlight before calling mutateDraft */
    if (mutationInFlight) return;
    mutationInFlight = true;
    try {
      const previousDraft = cloneDraft(displayedBoard.draft);
      const token = await tokenForDisplayedBoard();
      if (!token) {
        throw new MutationAborted("無法取得操作權限，請再試一次。");
      }

      let applied: GameStateView | null;
      try {
        applied = await onUpdateDraft(token, cloneDraft(nextDraft));
      } catch (error) {
        throw new Error(mutationErrorMessage(error), { cause: error });
      }
      if (applied === null) {
        throw new MutationAborted("草稿未被接受，請再試一次。");
      }

      if (options.recordUndo !== false) {
        undoDraft = previousDraft;
        undoBoardId = displayedBoard.id;
      } else {
        undoDraft = null;
        undoBoardId = null;
      }
      mutationInFlight = false;
      await focusAfterRender(focusKey);
    } finally {
      mutationInFlight = false;
    }
  }

  async function handleDraft(
    draft: AnalysisDraft,
    focusKey: string,
  ): Promise<void> {
    /* v8 ignore next -- unreachable: child board components guard against duplicate actions with their own pending state before calling onDraft */
    if (mutationInFlight) return;
    mutationError = null;
    try {
      await mutateDraft(draft, focusKey);
    } catch (error) {
      // Aborted mutations (null callback results) are already surfaced by the
      // shared game client's gameState.error / ErrorBanner — don't duplicate.
      if (!(error instanceof MutationAborted)) {
        mutationError = mutationErrorMessage(error);
      }
      throw error;
    }
  }

  async function resetDraft(): Promise<void> {
    if (mutationInFlight) return;
    mutationError = null;
    const displayedBoard = board;
    /* v8 ignore next -- unreachable: reset button only renders when board is non-null */
    if (!displayedBoard) return;
    try {
      await mutateDraft(emptyDraft(displayedBoard.kind), "reset");
    } catch (error) {
      if (!(error instanceof MutationAborted)) {
        mutationError = mutationErrorMessage(error);
      }
    }
  }

  async function undo(): Promise<void> {
    /* v8 ignore next -- unreachable: undo button only renders when canUndo and undoDraft are set */
    if (!canUndo || undoDraft === null) return;
    if (mutationInFlight) return;
    mutationError = null;
    try {
      await mutateDraft(undoDraft, "undo", { recordUndo: false });
    } catch (error) {
      if (!(error instanceof MutationAborted)) {
        mutationError = mutationErrorMessage(error);
      }
    }
  }

  async function submit(): Promise<void> {
    const currentMode = analysisMode;
    /* v8 ignore next -- unreachable: submit button only renders when board is editable */
    if (!currentMode || !board || boardReadOnly || disabled) return;
    if (mutationInFlight) return;
    // Clear any stale error from a previous attempt before retrying, so a
    // successful retry does not render the old alert alongside new feedback.
    mutationError = null;
    mutationInFlight = true;
    try {
      const token = await tokenForDisplayedBoard();
      if (!token) {
        // Reconciliation failed; gameState.error already owns the alert.
        return;
      }

      let applied: GameStateView | null;
      try {
        applied = await onSubmit(token);
      } catch (error) {
        mutationError = mutationErrorMessage(error);
        return;
      }
      if (applied === null) {
        // Backend rejected; gameState.error already owns the alert.
        return;
      }

      const returnedFeedback =
        applied.mode.type === "analysis" ? applied.mode.feedback : null;
      mutationInFlight = false;
      if (returnedFeedback !== null) {
        focusFeedbackOnRender = true;
        await focusAfterRender("feedback");
      } else {
        await focusAfterRender("submit");
      }
    } finally {
      mutationInFlight = false;
    }
  }

  async function selectBoard(boardId: string): Promise<void> {
    const currentMode = analysisMode;
    /* v8 ignore next -- unreachable: board nav buttons only render in analysis mode */
    if (!currentMode || disabled) return;
    const targetBoard = analysis?.visibleBoards.find(
      (candidate) => candidate.id === boardId,
    );
    /* v8 ignore next -- unreachable: locked board nav buttons are disabled, so selectBoard is never called with a locked or current board ID */
    if (
      !targetBoard ||
      (!targetBoard.available && !targetBoard.completed) ||
      targetBoard.id === currentMode.boardId
    ) {
      return;
    }
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
    /* v8 ignore next -- unreachable: relative nav buttons only render when a board is active */
    if (!currentBoardId) return;
    const index = navigationBoards.findIndex(
      (candidate) => candidate.id === currentBoardId,
    );
    const next = navigationBoards[index + offset];
    /* v8 ignore next -- unreachable: relative nav buttons are disabled at list boundaries */
    if (next) await selectBoard(next.id);
  }

  async function toggleHint(): Promise<void> {
    /* v8 ignore next -- unreachable: hint toggle only renders when board has a hint and is editable */
    if (!board?.hint || boardReadOnly) return;
    hintOpen = !hintOpen;
    await focusAfterRender("hint");
  }
</script>

<section
  bind:this={workbenchElement}
  class="analysis-workbench"
  aria-label="分析工作台"
>
  {#if analysis && analysisMode}
    <aside class="analysis-rail" aria-label="本案分析">
      <div class="rail-heading">
        <p class="eyebrow">分析工作台</p>
        <h1>本案分析</h1>
        <p class="rail-scene-title">{analysis.title}</p>
        <p class="rail-summary">{analysis.summary}</p>
      </div>

      <nav class="board-navigation" aria-label="分析板導覽">
        {#each railBoards as candidate (candidate.id)}
          {@const state = boardState(candidate)}
          {@const progress = analysisBoardProgress(candidate)}
          {@const descriptionId = `analysis-board-description-${candidate.id}`}
          <span id={descriptionId} class="sr-only">
            {boardStateLabel(state, candidate.readOnly)}，進度 {progress.current}
            / {progress.target}
          </span>
          <button
            type="button"
            aria-label={candidate.label}
            aria-describedby={descriptionId}
            aria-current={candidate.id === analysisMode.boardId
              ? "page"
              : undefined}
            disabled={disabled ||
              state === "locked" ||
              candidate.id === analysisMode.boardId}
            data-analysis-board-id={candidate.id}
            data-analysis-board-state={state}
            onclick={() => selectBoard(candidate.id)}
          >
            <span class="board-entry-heading">
              <span>{candidate.label}</span>
              <span class="board-entry-state"
                >{boardStateLabel(state, candidate.readOnly)}</span
              >
            </span>
            <span class="board-entry-kind"
              >{boardKindLabel(candidate.kind)}</span
            >
            <span class="board-entry-progress">
              <span>進度</span>
              <strong>{progress.current} / {progress.target}</strong>
            </span>
            <progress
              max={100}
              value={progress.percent}
              aria-label={`${candidate.label}進度`}
              >{progress.current} / {progress.target}</progress
            >
          </button>
        {/each}
      </nav>

      <div class="overall-progress" aria-label="整體分析進度">
        <div class="overall-progress-heading">
          <span>整體分析</span>
          <strong
            >已完成 {overallProgress.current} / {overallProgress.target}</strong
          >
        </div>
        <progress
          max={Math.max(overallProgress.target, 1)}
          value={overallProgress.current}
          aria-label="整體分析進度"
          >{overallProgress.current} / {overallProgress.target}</progress
        >
      </div>
    </aside>

    <section class="board-region" aria-label="目前分析板">
      {#if board}
        <header class="board-header">
          <div class="board-heading-copy">
            <p class="eyebrow">{boardKindLabel(board.kind)}</p>
            <h2 tabindex="-1" data-analysis-focus-key={`board:${board.id}`}>
              {board.label}
            </h2>
            <p class="board-prompt">{board.prompt}</p>
          </div>

          <div class="board-header-actions">
            {#if board.hint !== null}
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
            {#if board.completed}
              <p class="board-status completed" role="status">完成・只讀檢視</p>
            {:else if board.readOnly}
              <p class="board-status read-only" role="status">目前只讀</p>
            {:else if !board.available}
              <p class="board-status locked" role="status">尚未解鎖</p>
            {/if}
          </div>

          {#if hintOpen && board.hint !== null}
            <p class="board-hint">提示：{board.hint}</p>
          {/if}
        </header>

        <div
          class="board-workspace"
          data-analysis-workspace=""
          role="region"
          aria-label="分析板"
        >
          {#if board.kind === "classify"}
            <ClassifyBoard
              {board}
              onDraft={handleDraft}
              disabled={disabled || mutationInFlight}
              readOnly={boardReadOnly}
            />
          {:else if board.kind === "order"}
            <OrderBoard
              {board}
              onDraft={handleDraft}
              disabled={disabled || mutationInFlight}
              readOnly={boardReadOnly}
            />
          {:else}
            <ThresholdBoard
              {board}
              {inventory}
              onDraft={handleDraft}
              disabled={disabled || mutationInFlight}
              readOnly={boardReadOnly}
            />
          {/if}
        </div>

        <footer class="workbench-footer" aria-label="分析操作">
          {#if boardFeedback}
            <p
              bind:this={feedbackElement}
              class="feedback rejected"
              role="status"
              tabindex="-1"
              data-analysis-focus-key="feedback"
            >
              <span class="feedback-label">REJECTED</span>
              <span>{boardFeedback.message}</span>
            </p>
          {/if}

          {#if mutationError}
            <p class="feedback" role="alert">{mutationError}</p>
          {/if}

          <div class="footer-controls">
            {#if navigationBoards.length > 1}
              <div class="relative-navigation" aria-label="相鄰分析板">
                <button
                  type="button"
                  disabled={disabled ||
                    navigationBoards[0]?.id === analysisMode.boardId}
                  onclick={() => selectRelative(-1)}
                >
                  上一板
                </button>
                <button
                  type="button"
                  disabled={disabled ||
                    navigationBoards.at(-1)?.id === analysisMode.boardId}
                  onclick={() => selectRelative(1)}
                >
                  下一板
                </button>
              </div>
            {/if}

            {#if !boardReadOnly}
              {#if canUndo}
                <button
                  type="button"
                  data-analysis-focus-key="undo"
                  disabled={disabled || mutationInFlight}
                  onclick={undo}
                >
                  復原
                </button>
              {/if}
              <button
                type="button"
                data-analysis-focus-key="reset"
                disabled={disabled || mutationInFlight}
                onclick={resetDraft}
              >
                重設
              </button>
              <button
                type="button"
                class="submit"
                data-analysis-focus-key="submit"
                disabled={disabled || mutationInFlight}
                onclick={submit}
              >
                比對推論
              </button>
            {/if}
          </div>
        </footer>
      {:else}
        <p class="feedback" role="status">分析板載入中。</p>
      {/if}
    </section>
  {:else}
    <p class="feedback" role="status">分析板載入中。</p>
  {/if}
</section>

<style>
  .analysis-workbench {
    box-sizing: border-box;
    display: grid;
    grid-template-columns: minmax(220px, 272px) minmax(0, 1fr);
    width: 100%;
    height: 100%;
    min-height: 0;
    overflow: hidden;
    color: #efedf0;
    background: rgba(8, 10, 16, 0.54);
  }

  .analysis-rail {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 1.15rem 0.9rem;
    background: rgba(12, 16, 24, 0.92);
    border-right: 1px solid rgba(179, 191, 214, 0.28);
  }

  .rail-heading,
  .board-heading-copy,
  .overall-progress-heading {
    display: grid;
    gap: 0.35rem;
  }

  .rail-heading h1,
  .rail-heading p,
  .board-heading-copy h2,
  .board-heading-copy p,
  .overall-progress-heading,
  .board-entry-heading,
  .board-entry-kind,
  .board-entry-progress,
  .board-status,
  .board-hint,
  .feedback {
    margin: 0;
  }

  .rail-heading h1 {
    font-size: clamp(1.25rem, 2vw, 1.7rem);
    letter-spacing: 0.08em;
  }

  .rail-scene-title {
    margin-top: 0.4rem !important;
    color: #efedf0;
    font-size: 0.94rem;
    font-weight: 700;
  }

  .rail-summary {
    color: #c9cbd1;
    font-size: 0.82rem;
    line-height: 1.6;
  }

  .eyebrow {
    margin: 0;
    color: #9cb6df;
    font-size: 0.82rem;
    letter-spacing: 0.13em;
  }

  .board-navigation {
    display: grid;
    align-content: start;
    gap: 0.55rem;
    margin: 1.2rem 0;
  }

  .board-navigation button {
    display: grid;
    gap: 0.4rem;
    width: 100%;
    padding: 0.72rem 0.75rem;
    color: #d6e5ff;
    font: inherit;
    text-align: left;
    background: rgba(91, 135, 210, 0.1);
    border: 1px solid rgba(168, 200, 255, 0.28);
    cursor: pointer;
  }

  .board-navigation button[aria-current="page"] {
    color: #11151c;
    background: #b9cef1;
    border-color: #b9cef1;
  }

  .board-navigation button[data-analysis-board-state="completed"] {
    border-left: 3px solid #79bd9d;
  }

  .board-navigation button[data-analysis-board-state="locked"] {
    color: #969ba7;
    background: rgba(255, 255, 255, 0.025);
    border-style: dashed;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .board-entry-heading,
  .board-entry-progress {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .board-entry-heading > span:first-child {
    font-weight: 700;
  }

  .board-entry-state,
  .board-entry-kind,
  .board-entry-progress {
    color: #aeb4c1;
    font-size: 0.75rem;
  }

  .board-entry-state {
    white-space: nowrap;
  }

  .board-navigation button[aria-current="page"] .board-entry-state,
  .board-navigation button[aria-current="page"] .board-entry-kind,
  .board-navigation button[aria-current="page"] .board-entry-progress {
    color: #3b4658;
  }

  progress {
    display: block;
    width: 100%;
    height: 0.38rem;
    accent-color: #9cb6df;
  }

  .overall-progress {
    display: grid;
    gap: 0.45rem;
    padding-top: 0.9rem;
    border-top: 1px solid rgba(179, 191, 214, 0.2);
  }

  .overall-progress-heading {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    color: #c9cbd1;
    font-size: 0.78rem;
  }

  .overall-progress-heading strong {
    color: #efedf0;
    font-size: 0.75rem;
    white-space: nowrap;
  }

  .board-region {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
  }

  .board-header {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 0.6rem 1rem;
    padding: 1.2rem clamp(1rem, 2.5vw, 2rem) 0.9rem;
    border-bottom: 1px solid rgba(179, 191, 214, 0.2);
  }

  .board-heading-copy h2 {
    font-size: clamp(1.3rem, 2.4vw, 2rem);
    letter-spacing: 0.04em;
  }

  .board-heading-copy h2:focus-visible {
    outline: 3px solid #e2ad69;
    outline-offset: 4px;
  }

  .board-prompt {
    color: #c9cbd1;
    line-height: 1.6;
  }

  .board-header-actions {
    display: grid;
    align-content: start;
    justify-items: end;
    gap: 0.5rem;
  }

  .hint-toggle,
  .footer-controls button {
    padding: 0.52rem 0.8rem;
    color: #d6e5ff;
    font: inherit;
    background: rgba(91, 135, 210, 0.14);
    border: 1px solid rgba(168, 200, 255, 0.4);
    cursor: pointer;
  }

  .hint-toggle {
    color: #f2d1b2;
    background: rgba(154, 104, 61, 0.16);
    border-color: rgba(226, 173, 105, 0.42);
  }

  .board-status {
    padding: 0.4rem 0.62rem;
    color: #c9cbd1;
    border-left: 3px solid #e2ad69;
    font-size: 0.78rem;
    white-space: nowrap;
  }

  .board-status.completed {
    color: #bde6ce;
    border-left-color: #79bd9d;
  }

  .board-status.locked {
    color: #aeb4c1;
    border-left-color: #777e8c;
  }

  .board-hint {
    grid-column: 1 / -1;
    padding: 0.58rem 0.75rem;
    color: #c9dfff;
    background: rgba(91, 135, 210, 0.14);
    border-left: 3px solid #a8c8ff;
    font-size: 0.86rem;
  }

  .board-workspace {
    min-width: 0;
    min-height: 0;
    overflow: auto;
    padding: 1rem clamp(1rem, 2.5vw, 2rem);
  }

  .workbench-footer {
    display: grid;
    gap: 0.65rem;
    padding: 0.8rem clamp(1rem, 2.5vw, 2rem);
    background: rgba(12, 16, 24, 0.96);
    border-top: 1px solid rgba(179, 191, 214, 0.28);
  }

  .footer-controls,
  .relative-navigation {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
  }

  .footer-controls {
    justify-content: space-between;
  }

  .relative-navigation {
    margin-right: auto;
  }

  .footer-controls .submit {
    color: #11151c;
    font-weight: 700;
    background: #b9cef1;
  }

  .feedback {
    display: flex;
    flex-wrap: wrap;
    gap: 0.7rem;
    padding: 0.62rem 0.8rem;
    color: #f2d1b2;
    background: rgba(154, 104, 61, 0.25);
    border-left: 3px solid #e2ad69;
    line-height: 1.45;
  }

  .feedback-label {
    color: #ffd29a;
    font-size: 0.76rem;
    font-weight: 700;
    letter-spacing: 0.12em;
  }

  .board-navigation button:focus-visible,
  .footer-controls button:focus-visible,
  .hint-toggle:focus-visible,
  [data-analysis-focus-key="feedback"]:focus-visible {
    outline: 3px solid #e2ad69;
    outline-offset: 3px;
  }

  .board-navigation button:disabled,
  .footer-controls button:disabled,
  .hint-toggle:disabled {
    cursor: default;
    opacity: 0.52;
  }

  @media (max-height: 760px) and (min-width: 761px) {
    .analysis-rail {
      padding-block: 0.75rem;
    }

    .board-navigation {
      margin-block: 0.75rem;
      gap: 0.35rem;
    }

    .board-navigation button {
      gap: 0.25rem;
      padding-block: 0.5rem;
    }

    .board-header {
      padding-block: 0.75rem;
    }

    .board-workspace {
      padding-block: 0.7rem;
    }

    .workbench-footer {
      padding-block: 0.6rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .analysis-workbench button {
      transition: none;
    }
  }
</style>
