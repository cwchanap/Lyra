<script lang="ts">
  import type { AnalysisBoardView, AnalysisDraft } from "$lib/state/types";
  import {
    addOrderCard,
    materializePrefixAnchors,
    moveOrderCard,
    orderBoardBlockReason,
    prefixAnchors,
    publicCards,
    removeOrderCard,
  } from "$lib/analysis/order-draft";
  import AnalysisCard from "./AnalysisCard.svelte";

  type OrderBoardView = Extract<AnalysisBoardView, { kind: "order" }>;
  type OrderDraft = Extract<AnalysisDraft, { kind: "order" }>;

  let {
    board,
    headingFocusKey = null,
    onDraft,
    disabled = false,
    readOnly = false,
  }: {
    board: OrderBoardView;
    headingFocusKey?: string | null;
    onDraft: (draft: OrderDraft, focusKey: string) => void | Promise<void>;
    disabled?: boolean;
    readOnly?: boolean;
  } = $props();

  let blockReason = $derived(orderBoardBlockReason(board));
  let pending = $state(false);
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
    new Set((safeAnchors ?? []).map((anchor) => anchor.cardId)),
  );
  let fixedPrefixLength = $derived(
    // When blockReason !== null, safeAnchors is null, so (null ?? []).length
    // is 0 — identical to the previous ternary but without an unreachable
    // branch.
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
</script>

<section class="order-board" aria-label="排序板">
  <header>
    <p class="eyebrow">事件順序</p>
    <h2 data-analysis-focus-key={headingFocusKey ?? undefined} tabindex="-1">
      {board.label}
    </h2>
    <p>{board.prompt}</p>
  </header>

  {#if board.hint}
    <p class="hint">提示：{board.hint}</p>
  {/if}

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
      {:else}
        <ol class="timeline">
          {#each displayedCardIds as cardId, index (cardId)}
            {@const card = cardsById.get(cardId)}
            {@const fixed = fixedAnchorIds.has(cardId)}
            <li class:fixed>
              {#if card}
                <AnalysisCard {card} readOnly={!editable} />
              {:else}
                <article class="stale-card">
                  <strong>{cardId}</strong>
                  <span>尚未取得卡片資料</span>
                </article>
              {/if}

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
            </li>
          {/each}
        </ol>
      {/if}
    </section>

    <section class="card-pool" aria-label="未加入時間線">
      <h3>待加入</h3>
      {#if unplacedCards.length === 0}
        <p class="empty">所有事件都已放入時間線。</p>
      {:else}
        <div class="cards">
          {#each unplacedCards as card (card.id)}
            <div class="card-entry">
              <AnalysisCard {card} readOnly={!editable} />
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
  .order-board {
    display: grid;
    gap: 1.25rem;
    width: min(980px, calc(100vw - 2rem));
    margin: 3rem auto;
    padding: clamp(1.25rem, 3vw, 2rem);
    color: #efedf0;
    background: rgba(16, 20, 29, 0.95);
    border: 1px solid rgba(179, 191, 214, 0.38);
    box-shadow: 0 1.5rem 4rem rgba(0, 0, 0, 0.4);
  }

  header p {
    margin: 0.4rem 0 0;
    line-height: 1.65;
  }

  h2,
  h3 {
    margin: 0;
  }

  h2 {
    font-size: clamp(1.25rem, 3vw, 1.8rem);
  }

  h3 {
    font-size: 1rem;
  }

  .eyebrow {
    margin: 0;
    color: #9cb6df;
    font-size: 0.82rem;
    letter-spacing: 0.13em;
  }

  .hint,
  .empty,
  .blocked {
    margin: 0;
    color: #c9cbd1;
    font-size: 0.9rem;
  }

  .hint {
    padding: 0.7rem 0.85rem;
    background: rgba(91, 135, 210, 0.14);
    border-left: 3px solid #a8c8ff;
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

  .timeline li.fixed {
    border-left: 3px solid #e2ad69;
    padding-left: 0.6rem;
  }

  .fixed-label {
    color: #e2ad69;
    font-size: 0.8rem;
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
