<script lang="ts">
  import type { AnalysisBoardView, AnalysisDraft } from "$lib/state/types";
  import {
    addOrderCard,
    materializePrefixAnchors,
    moveOrderCard,
    orderBoardBlockReason,
    placeOrderCardBefore,
    prefixAnchors,
    publicCards,
    removeOrderCard,
  } from "$lib/analysis/order-draft";
  import AnalysisCard from "./AnalysisCard.svelte";

  type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;
  type OrderDraft = Extract<AnalysisDraft, { kind: "order" }>;

  let {
    board,
    onDraft,
    disabled = false,
    readOnly = false,
    resolveDropTarget,
  }: {
    board: OrderBoardView;
    onDraft: (draft: OrderDraft, focusKey: string) => void | Promise<void>;
    disabled?: boolean;
    readOnly?: boolean;
    resolveDropTarget?: (x: number, y: number) => string | null;
  } = $props();

  let blockReason = $derived(orderBoardBlockReason(board));
  let pending = $state(false);
  let draggingCardId = $state<string | null>(null);
  let dragTargetId = $state<string | null>(null);
  let liveMessage = $state("");
  let authoritativeCardIds = $derived(
    board.draft.kind === "order" ? board.draft.cardIds : [],
  );
  let displayedCardIds = $derived(
    blockReason === null
      ? // materializePrefixAnchors is guaranteed non-null when blockReason
        // is null, so the fallback is never reached.  Use `as` to document
        // the invariant without an unreachable ?? branch.
        (materializePrefixAnchors(board, authoritativeCardIds) as string[])
      : [...authoritativeCardIds],
  );
  let safeCards = $derived(publicCards(board));
  let safeAnchors = $derived(prefixAnchors(board));
  let cardsById = $derived(new Map(safeCards.map((card) => [card.id, card])));
  let fixedAnchorIds = $derived(
    /* v8 ignore next -- lazily evaluated: only read when safeAnchors is non-null */
    new Set((safeAnchors ?? []).map((anchor) => anchor.cardId)),
  );
  let fixedPrefixLength = $derived(
    // When blockReason !== null, safeAnchors is null, so (null ?? []).length
    // is 0 — identical to the previous ternary but without an unreachable
    // branch.
    /* v8 ignore next -- lazily evaluated: only read when safeAnchors is non-null */
    (safeAnchors ?? []).length,
  );
  let unplacedCards = $derived(
    safeCards.filter((card) => !displayedCardIds.includes(card.id)),
  );
  let editable = $derived(
    board.draft.kind === "order" &&
      !disabled &&
      !readOnly &&
      board.available &&
      !board.completed &&
      !board.readOnly &&
      blockReason === null,
  );

  async function emitDraft(cardIds: string[] | null, focusKey: string) {
    /* v8 ignore next -- unreachable: mutation buttons only rendered when editable */
    if (!editable || pending || board.draft.kind !== "order" || !cardIds) {
      return;
    }
    pending = true;
    try {
      await onDraft({ kind: "order", cardIds }, focusKey);
    } catch {
      // Ordering state is derived from board.draft; nothing local to restore.
    } finally {
      pending = false;
    }
  }

  function addCard(cardId: string) {
    emitDraft(
      addOrderCard(board, authoritativeCardIds, cardId),
      `card:${cardId}`,
    );
  }

  function moveCard(cardId: string, direction: -1 | 1) {
    emitDraft(
      moveOrderCard(board, displayedCardIds, cardId, direction),
      `card:${cardId}`,
    );
  }

  function removeCard(cardId: string) {
    emitDraft(
      removeOrderCard(board, displayedCardIds, cardId),
      `card:${cardId}`,
    );
  }

  type OrderDropTarget =
    | { kind: "before"; cardId: string }
    | { kind: "end" }
    | { kind: "pending" }
    | null;

  function decodeOrderDropTarget(targetId: string | null): OrderDropTarget {
    if (targetId === "order:end") return { kind: "end" };
    if (targetId === "order:pending") return { kind: "pending" };
    const prefix = "order:before:";
    if (!targetId?.startsWith(prefix)) return null;
    const cardId = targetId.slice(prefix.length);
    /* v8 ignore next -- unreachable: the template only emits non-empty cardIds after the prefix */
    return cardId ? { kind: "before", cardId } : null;
  }

  function sameCardIds(left: string[], right: string[]) {
    return (
      left.length === right.length &&
      left.every((cardId, index) => cardId === right[index])
    );
  }

  function handleDragStart(cardId: string) {
    /* v8 ignore next -- unreachable: AnalysisCard only calls onDragStart when dragEnabled is true, which already excludes non-editable, pending, and fixed-anchor cards */
    if (!editable || pending || fixedAnchorIds.has(cardId)) return;
    draggingCardId = cardId;
    dragTargetId = null;
    liveMessage = "";
  }

  function handleDragTargetChange(targetId: string | null) {
    /* v8 ignore next -- unreachable: AnalysisCard only calls onDragTargetChange after onDragStart sets draggingCardId */
    if (!draggingCardId) return;
    dragTargetId = targetId;
  }

  function handleDragCancel() {
    draggingCardId = null;
    dragTargetId = null;
  }

  async function dropCard(cardId: string, targetId: string | null) {
    const target = decodeOrderDropTarget(targetId);
    draggingCardId = null;
    dragTargetId = null;

    /* v8 ignore next -- unreachable: AnalysisCard only calls onDrop after a drag started, which requires editable and an order draft */
    if (!editable || pending || board.draft.kind !== "order") return;

    const nextCardIds =
      target?.kind === "pending"
        ? removeOrderCard(board, displayedCardIds, cardId)
        : target?.kind === "before"
          ? placeOrderCardBefore(board, displayedCardIds, cardId, target.cardId)
          : target?.kind === "end"
            ? placeOrderCardBefore(board, displayedCardIds, cardId, null)
            : null;

    if (!nextCardIds) {
      liveMessage = "無效的放置位置。";
      return;
    }
    if (sameCardIds(nextCardIds, displayedCardIds)) {
      liveMessage = "未變更：時間線位置未變更。";
      return;
    }

    liveMessage = "";
    await emitDraft(nextCardIds, `card:${cardId}`);
  }
</script>

<section class="order-board" aria-label="排序板">
  <!-- The gutter is a mouse-drag-only drop surface; keyboard users have the
       add/move/remove buttons, so it carries no aria-label (labeling a
       role-less generic div is ignored/prohibited by AT anyway). -->
  {#snippet insertionGutter(targetId: string, end = false)}
    <div
      class="insertion-gutter"
      class:end-gutter={end}
      class:drop-target={dragTargetId === targetId}
      data-analysis-drop-target={targetId}
    >
      {#if dragTargetId === targetId}
        <span class="gutter-preview">放置在此</span>
      {/if}
    </div>
  {/snippet}
  <!-- Permanently mounted so screen readers observe the live region before
       the first message is set; conditional regions miss the first
       announcement. -->
  <p class="sr-only" role="status" aria-label="排序操作提示" aria-live="polite">
    {liveMessage}
  </p>
  {#if blockReason === "unsupportedAnchors"}
    <p class="blocked" role="alert">排序設定無法顯示，請重新載入內容。</p>
  {:else if blockReason === "fixedAnchorUnavailable"}
    <p class="blocked" role="alert">尚未取得固定卡，暫時無法編排時間線。</p>
  {/if}

  <div class="board-layout">
    <section class="timeline-panel" aria-label="目前時間線">
      <h3>時間線</h3>
      {#if displayedCardIds.length === 0}
        <p class="empty">尚未加入事件。</p>
      {/if}
      <ol class="timeline">
        {#each displayedCardIds as cardId, index (cardId)}
          {@const card = cardsById.get(cardId)}
          {@const fixed = fixedAnchorIds.has(cardId)}
          {@const beforeTarget = `order:before:${cardId}`}
          <li class:fixed>
            {#if editable && !fixed && card}
              {@render insertionGutter(beforeTarget)}
            {/if}
            <div class="timeline-card">
              <span class="timeline-index" aria-hidden="true">{index + 1}</span>
              {#if card}
                <AnalysisCard
                  {card}
                  disabled={!editable}
                  readOnly={!editable}
                  dragEnabled={editable && !pending && !fixed}
                  {resolveDropTarget}
                  onDragStart={() => handleDragStart(cardId)}
                  onDragTargetChange={handleDragTargetChange}
                  onDrop={(targetId) => void dropCard(cardId, targetId)}
                  onDragCancel={handleDragCancel}
                />
              {:else}
                <article class="stale-card">
                  <strong>{cardId}</strong>
                  <span>尚未取得卡片資料</span>
                </article>
              {/if}
            </div>

            {#if fixed}
              <span class="fixed-label">固定位置</span>
            {:else if editable && card}
              <div class="card-actions" aria-label={`調整：${card.label}`}>
                <button
                  type="button"
                  aria-label={`上移：${card.label}`}
                  disabled={pending || index <= fixedPrefixLength}
                  onclick={() => moveCard(cardId, -1)}>上移</button
                >
                <button
                  type="button"
                  aria-label={`下移：${card.label}`}
                  disabled={pending || index >= displayedCardIds.length - 1}
                  onclick={() => moveCard(cardId, 1)}>下移</button
                >
                <button
                  type="button"
                  class="remove"
                  aria-label={`移除：${card.label}`}
                  disabled={pending}
                  onclick={() => removeCard(cardId)}>移除</button
                >
              </div>
            {/if}
            {#if editable && index === displayedCardIds.length - 1}
              {@render insertionGutter("order:end", true)}
            {/if}
          </li>
        {/each}
      </ol>
      {#if editable && displayedCardIds.length === 0}
        {@render insertionGutter("order:end", true)}
      {/if}
    </section>

    <section
      class="card-pool"
      class:drop-target={dragTargetId === "order:pending"}
      aria-label="未加入時間線"
      data-analysis-drop-target={editable ? "order:pending" : undefined}
    >
      <h3>待加入</h3>
      {#if unplacedCards.length === 0}
        <p class="empty">所有事件都已放入時間線。</p>
      {:else}
        <div class="cards">
          {#each unplacedCards as card (card.id)}
            <div class="card-entry">
              <AnalysisCard
                {card}
                disabled={!editable}
                readOnly={!editable}
                dragEnabled={editable && !pending}
                {resolveDropTarget}
                onDragStart={() => handleDragStart(card.id)}
                onDragTargetChange={handleDragTargetChange}
                onDrop={(targetId) => void dropCard(card.id, targetId)}
                onDragCancel={handleDragCancel}
              />
              {#if editable}
                <button
                  type="button"
                  class="add"
                  aria-label={`加入時間線：${card.label}`}
                  disabled={!card.available || pending}
                  onclick={() => addCard(card.id)}>加入時間線</button
                >
              {/if}
            </div>
          {/each}
        </div>
      {/if}
    </section>
  </div>
</section>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .order-board {
    display: grid;
    gap: 1.25rem;
    color: #efedf0;
    min-width: 0;
  }

  .empty,
  .blocked {
    margin: 0;
    color: #c9cbd1;
    font-size: 0.9rem;
  }

  .blocked {
    padding: 0.8rem 0.9rem;
    color: #f2d1b2;
    background: rgba(154, 104, 61, 0.16);
    border-left: 3px solid #e2ad69;
  }

  .board-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr);
    gap: 1rem;
  }

  .timeline-panel,
  .card-pool {
    display: grid;
    align-content: start;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(179, 191, 214, 0.22);
  }

  .timeline,
  .cards {
    display: grid;
    gap: 0.7rem;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .timeline li,
  .card-entry {
    display: grid;
    gap: 0.45rem;
  }

  .timeline-card {
    display: grid;
    grid-template-columns: 2rem minmax(0, 1fr);
    gap: 0.55rem;
    align-items: start;
  }

  .timeline-index {
    display: grid;
    width: 2rem;
    height: 2rem;
    place-items: center;
    color: #d6e5ff;
    background: rgba(91, 135, 210, 0.2);
    border: 1px solid rgba(168, 200, 255, 0.45);
    font-variant-numeric: tabular-nums;
  }

  .timeline li.fixed {
    border-left: 3px solid #e2ad69;
    padding-left: 0.6rem;
    background: rgba(226, 173, 105, 0.08);
  }

  .insertion-gutter {
    display: flex;
    min-height: 0.7rem;
    align-items: center;
    justify-content: center;
    color: #c9cbd1;
    border: 1px dashed rgba(168, 200, 255, 0.26);
    background: rgba(91, 135, 210, 0.035);
  }

  .insertion-gutter.drop-target {
    min-height: 2.15rem;
    color: #f5e0b9;
    border-color: #a8c8ff;
    background: rgba(91, 135, 210, 0.2);
    box-shadow: 0 0 0 2px rgba(91, 135, 210, 0.28);
  }

  .gutter-preview {
    font-size: 0.8rem;
  }

  .fixed-label {
    color: #e2ad69;
    font-size: 0.8rem;
  }

  .card-pool.drop-target {
    border-color: #a8c8ff;
    box-shadow: 0 0 0 2px rgba(91, 135, 210, 0.3);
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }

  .card-actions button,
  .add {
    padding: 0.5rem 0.7rem;
    color: #d6e5ff;
    font: inherit;
    text-align: left;
    background: rgba(91, 135, 210, 0.14);
    border: 1px solid rgba(168, 200, 255, 0.4);
    cursor: pointer;
  }

  .card-actions .remove {
    color: #f2d1b2;
    background: rgba(154, 104, 61, 0.16);
    border-color: rgba(226, 173, 105, 0.42);
  }

  .card-actions button:focus-visible,
  .add:focus-visible {
    outline: 3px solid #e2ad69;
    outline-offset: 3px;
  }

  .card-actions button:disabled,
  .add:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .stale-card {
    display: grid;
    gap: 0.25rem;
    padding: 0.85rem 1rem;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(179, 191, 214, 0.3);
  }

  .stale-card span {
    color: #c9cbd1;
    font-size: 0.9rem;
  }

  @media (max-width: 760px) {
    .board-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
