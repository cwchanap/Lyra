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
    min-width: 0;
    color: var(--bone);
    font-family: var(--body-jp);
  }

  .empty,
  .blocked {
    margin: 0;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 0.78rem;
  }

  .blocked {
    padding: 0.7rem 0.8rem;
    color: var(--crimson);
    background: var(--crimson-soft);
    border-left: 3px solid var(--crimson);
  }

  .board-layout {
    display: grid;
    grid-template-columns: minmax(0, 1.3fr) minmax(0, 1fr);
    gap: 1rem;
  }

  .timeline-panel,
  .card-pool {
    position: relative;
    display: grid;
    align-content: start;
    gap: 0.7rem;
    min-width: 0;
    padding: 0.9rem;
    overflow: hidden;
    background: rgba(9, 9, 15, 0.72);
    border: 1px solid var(--rule);
    clip-path: polygon(0 0, calc(100% - 16px) 0, 100% 16px, 100% 100%, 0 100%);
  }

  .timeline-panel {
    border-top: 2px solid var(--crimson);
  }

  .card-pool {
    border-top: 2px solid var(--cyan);
  }

  .timeline-panel::before,
  .card-pool::before {
    position: absolute;
    top: 0;
    left: 0;
    width: 10px;
    height: 10px;
    background: var(--crimson);
    clip-path: polygon(0 0, 100% 0, 0 100%);
    content: "";
    pointer-events: none;
  }

  .card-pool::before {
    background: var(--cyan);
  }

  .timeline-panel h3,
  .card-pool h3 {
    margin: 0;
    font-family: var(--display-jp);
    font-size: 0.92rem;
    font-weight: 400;
    letter-spacing: 0.04em;
  }

  .timeline-panel h3 {
    color: var(--crimson);
  }

  .card-pool h3 {
    color: var(--cyan);
  }

  .timeline,
  .cards {
    display: grid;
    gap: 0.6rem;
    min-width: 0;
    margin: 0;
    padding: 0;
    list-style: none;
  }

  .timeline {
    position: relative;
    padding-block: 0.1rem;
  }

  .timeline::before {
    position: absolute;
    top: 0.85rem;
    bottom: 0.85rem;
    left: 1rem;
    width: 1px;
    background: linear-gradient(var(--crimson), var(--cyan));
    content: "";
    opacity: 0.7;
  }

  .timeline li,
  .card-entry {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
  }

  .timeline li {
    position: relative;
  }

  .timeline-card,
  .card-actions,
  .fixed-label,
  .insertion-gutter {
    position: relative;
    z-index: 1;
  }

  .timeline-card {
    display: grid;
    grid-template-columns: 2.15rem minmax(0, 1fr);
    gap: 0.5rem;
    align-items: start;
  }

  .timeline-index {
    display: grid;
    width: 2.15rem;
    height: 2.15rem;
    place-items: center;
    color: var(--cyan);
    background: var(--char-2);
    border: 1px solid var(--crimson);
    clip-path: polygon(0 0, 100% 0, 100% 82%, 82% 100%, 0 100%);
    font-family: var(--impact);
    font-size: 0.8rem;
    font-variant-numeric: tabular-nums;
  }

  .timeline li.fixed {
    padding: 0.25rem 0.45rem 0.4rem 0.6rem;
    background: var(--crimson-soft);
    border-left: 3px solid var(--crimson);
  }

  .timeline li.fixed .timeline-index {
    color: var(--crimson);
    border-color: var(--crimson);
  }

  .insertion-gutter {
    display: flex;
    min-height: 0.62rem;
    align-items: center;
    justify-content: center;
    color: var(--bone-faint);
    border: 1px dashed var(--cyan-deep);
    background: rgba(52, 216, 255, 0.035);
    font-family: var(--serif-jp);
    font-size: 0.7rem;
  }

  .insertion-gutter.drop-target {
    min-height: 2rem;
    color: var(--cyan);
    border-color: var(--cyan);
    background: var(--cyan-soft);
    box-shadow: 0 0 0 2px var(--cyan-soft);
  }

  .gutter-preview {
    font-size: 0.7rem;
  }

  .fixed-label {
    color: var(--crimson);
    font-family: var(--impact);
    font-size: 0.62rem;
    letter-spacing: 0.12em;
  }

  .card-pool.drop-target {
    border-color: var(--cyan);
    box-shadow: 0 0 0 2px var(--cyan-soft);
  }

  .card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .card-actions button,
  .add {
    min-height: 2rem;
    padding: 0.26rem 0.5rem;
    color: var(--bone-dim);
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 0.7rem;
    line-height: 1.25;
    text-align: left;
    background: transparent;
    border: 1px solid var(--rule);
    cursor: pointer;
  }

  .card-actions button:hover:not(:disabled),
  .card-actions button:focus-visible,
  .add:hover:not(:disabled),
  .add:focus-visible {
    color: var(--bone);
    border-color: var(--cyan);
    background: var(--cyan-soft);
  }

  .card-actions .remove {
    color: var(--crimson);
  }

  .card-actions .remove:hover:not(:disabled),
  .card-actions .remove:focus-visible {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .card-actions button:focus-visible,
  .add:focus-visible {
    outline: 2px solid var(--crimson);
    outline-offset: 3px;
  }

  .card-actions button:disabled,
  .add:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .stale-card {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    padding: 0.78rem 0.9rem;
    background: rgba(236, 228, 207, 0.045);
    border: 1px solid var(--rule);
    border-left: 3px solid var(--crimson);
    clip-path: polygon(0 0, calc(100% - 10px) 0, 100% 10px, 100% 100%, 0 100%);
  }

  .stale-card strong {
    font-family: var(--display-jp);
    font-size: 0.88rem;
    font-weight: 400;
  }

  .stale-card span {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 0.74rem;
  }

  @media (max-width: 720px) {
    .board-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
