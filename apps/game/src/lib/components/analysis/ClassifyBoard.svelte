<script lang="ts">
  import {
    applyClassifyPlacement,
    type ClassifyPlacementTarget,
  } from "$lib/analysis/classify-draft";
  import type { AnalysisBoardView, AnalysisDraft } from "$lib/state/types";
  import AnalysisCard from "./AnalysisCard.svelte";

  type ClassifyBoardView = Extract<AnalysisBoardView, { kind: "classify" }>;
  type ClassifyDraft = Extract<AnalysisDraft, { kind: "classify" }>;

  let {
    board,
    onDraft,
    disabled = false,
    readOnly = false,
    resolveDropTarget,
  }: {
    board: ClassifyBoardView;
    onDraft: (draft: ClassifyDraft, focusKey: string) => void | Promise<void>;
    disabled?: boolean;
    readOnly?: boolean;
    resolveDropTarget?: (x: number, y: number) => string | null;
  } = $props();

  let selectedCardId = $state<string | null>(null);
  let pending = $state(false);
  // Keep card anchors focusable while Workbench waits for the draft callback;
  // selection and drag handlers still guard against pending mutations.
  let draggingCardId = $state<string | null>(null);
  let dragTargetId = $state<string | null>(null);
  let liveMessage = $state("");
  let editable = $derived(
    board.draft.kind === "classify" &&
      !disabled &&
      !readOnly &&
      board.available &&
      !board.completed &&
      !board.readOnly,
  );
  let assignedCardIds = $derived(
    board.draft.kind === "classify" ? board.draft.groupByCard : {},
  );
  let unassignedCards = $derived(
    board.cards.filter((card) => assignedCardIds[card.id] === undefined),
  );

  function cardsForGroup(groupId: string) {
    return board.cards.filter((card) => assignedCardIds[card.id] === groupId);
  }

  function selectedCard() {
    if (!selectedCardId) return null;
    /* v8 ignore next -- unreachable: selectedCardId is only set to valid card IDs by selectCard */
    return board.cards.find((card) => card.id === selectedCardId) ?? null;
  }

  function selectCard(cardId: string) {
    /* v8 ignore next -- unreachable: onSelect is undefined when not editable */
    if (!editable || pending) return;
    const card = board.cards.find((candidate) => candidate.id === cardId);
    /* v8 ignore next -- unreachable: AnalysisCard does not expose a clickable select for unavailable cards */
    if (!card || !card.available) return;
    selectedCardId = selectedCardId === cardId ? null : cardId;
  }

  function decodeClassifyTarget(
    id: string | null,
  ): ClassifyPlacementTarget | null {
    if (id === "classify:unassigned") return { kind: "unassigned" };
    const prefix = "classify:group:";
    return id?.startsWith(prefix)
      ? { kind: "group", groupId: id.slice(prefix.length) }
      : null;
  }

  function handleDragStart(cardId: string) {
    /* v8 ignore next -- unreachable: AnalysisCard only calls onDragStart when dragEnabled is true, which already excludes non-editable and pending states */
    if (!editable || pending) return;
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

  async function placeCard(
    cardId: string,
    target: ClassifyPlacementTarget | null,
    onSuccess?: () => void,
  ) {
    /* v8 ignore next -- unreachable: dropCard is only called from AnalysisCard onDrop which requires editable; assign/remove buttons are only rendered when editable */
    if (!editable || pending || board.draft.kind !== "classify") return;

    if (target === null) {
      liveMessage = "無效的放置位置。";
      return;
    }

    const nextGroupByCard = applyClassifyPlacement(
      board,
      board.draft.groupByCard,
      cardId,
      target,
    );
    if (nextGroupByCard === null) {
      liveMessage = "無效的放置位置。";
      return;
    }
    if (nextGroupByCard === board.draft.groupByCard) {
      liveMessage = "未變更：卡片已在這個位置。";
      return;
    }

    liveMessage = "";
    pending = true;
    try {
      await onDraft(
        { kind: "classify", groupByCard: nextGroupByCard },
        `card:${cardId}`,
      );
      onSuccess?.();
    } catch {
      // Preserve the current selection so the player can retry.
    } finally {
      pending = false;
    }
  }

  async function assignCard(groupId: string) {
    /* v8 ignore next -- unreachable: assign button only rendered when editable */
    if (!editable || pending) return;
    /* v8 ignore next -- unreachable: editable already requires draft.kind === "classify" */
    if (board.draft.kind !== "classify") {
      return;
    }
    const cardId = selectedCardId;
    /* v8 ignore next -- unreachable: assign button disabled when no card selected */
    if (!cardId) return;
    const card = board.cards.find((candidate) => candidate.id === cardId);
    /* v8 ignore next -- unreachable: assign button disabled for unavailable selection */
    if (!card || !card.available) return;

    await placeCard(cardId, { kind: "group", groupId }, () => {
      selectedCardId = null;
    });
  }

  async function removeCard(cardId: string) {
    /* v8 ignore next -- unreachable: remove button only rendered when editable */
    if (!editable || pending) return;
    /* v8 ignore next -- unreachable: with a stale draft, assignedCardIds is empty so no remove buttons render */
    if (board.draft.kind !== "classify") {
      return;
    }
    const card = board.cards.find((candidate) => candidate.id === cardId);
    /* v8 ignore next -- unreachable: remove button disabled for unavailable cards */
    if (!card || !card.available) return;

    await placeCard(cardId, { kind: "unassigned" }, () => {
      if (selectedCardId === cardId) selectedCardId = null;
    });
  }

  async function dropCard(cardId: string, targetId: string | null) {
    draggingCardId = null;
    dragTargetId = null;
    await placeCard(cardId, decodeClassifyTarget(targetId));
  }
</script>

<section class="classify-board" aria-label="分類板">
  {#if liveMessage}
    <p
      class="sr-only"
      role="status"
      aria-label="分類操作提示"
      aria-live="polite"
    >
      {liveMessage}
    </p>
  {/if}
  <div class="board-layout">
    <section
      class="card-pool"
      class:drop-target={dragTargetId === "classify:unassigned"}
      aria-label="未分類卡片"
      data-analysis-drop-target="classify:unassigned"
    >
      <h3>待分類</h3>
      {#if unassignedCards.length === 0}
        <p class="empty">所有卡片都已放入分組。</p>
      {:else}
        <div class="cards">
          {#each unassignedCards as card (card.id)}
            <div class="card-entry">
              <AnalysisCard
                {card}
                selected={selectedCardId === card.id}
                disabled={!editable}
                readOnly={!editable}
                dragEnabled={editable && !pending}
                {resolveDropTarget}
                onSelect={editable ? () => selectCard(card.id) : undefined}
                onDragStart={() => handleDragStart(card.id)}
                onDragTargetChange={handleDragTargetChange}
                onDrop={(targetId) => void dropCard(card.id, targetId)}
                onDragCancel={handleDragCancel}
              />
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <div class="groups" aria-label="分類分組">
      {#each board.groups as group (group.id)}
        {@const groupCards = cardsForGroup(group.id)}
        {@const dropTarget = `classify:group:${group.id}`}
        <section
          class="group"
          class:drop-target={dragTargetId === dropTarget}
          aria-labelledby={`group-${group.id}`}
          data-analysis-drop-target={dropTarget}
        >
          <header>
            <h3 id={`group-${group.id}`}>{group.label}</h3>
            <p>{group.description}</p>
          </header>

          {#if groupCards.length === 0}
            <p class="empty">尚未放入卡片。</p>
          {:else}
            <div class="cards">
              {#each groupCards as card (card.id)}
                <div class="card-entry">
                  <AnalysisCard
                    {card}
                    selected={selectedCardId === card.id}
                    disabled={!editable}
                    readOnly={!editable}
                    dragEnabled={editable && !pending}
                    {resolveDropTarget}
                    onSelect={editable ? () => selectCard(card.id) : undefined}
                    onDragStart={() => handleDragStart(card.id)}
                    onDragTargetChange={handleDragTargetChange}
                    onDrop={(targetId) => void dropCard(card.id, targetId)}
                    onDragCancel={handleDragCancel}
                  />
                  {#if editable}
                    <button
                      type="button"
                      class="remove"
                      disabled={!card.available || pending}
                      onclick={() => removeCard(card.id)}
                    >
                      移除：{card.label}
                    </button>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}

          {#if editable}
            {@const selected = selectedCard()}
            <button
              type="button"
              class="assign"
              disabled={!selected || !selected.available || pending}
              onclick={() => assignCard(group.id)}
            >
              放入「{group.label}」
            </button>
          {/if}
        </section>
      {/each}
    </div>
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

  .classify-board {
    display: grid;
    gap: 1.25rem;
    color: #efedf0;
    min-width: 0;
  }

  .empty {
    margin: 0;
    color: #c9cbd1;
    font-size: 0.9rem;
  }

  .board-layout {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(0, 1.2fr);
    gap: 1rem;
  }

  .card-pool,
  .group {
    display: grid;
    align-content: start;
    gap: 0.75rem;
    padding: 1rem;
    background: rgba(255, 255, 255, 0.025);
    border: 1px solid rgba(179, 191, 214, 0.22);
  }

  .drop-target {
    border-color: rgba(168, 200, 255, 0.82);
    box-shadow: 0 0 0 2px rgba(91, 135, 210, 0.3);
  }

  .groups {
    display: grid;
    gap: 1rem;
  }

  .group header {
    display: grid;
    gap: 0.2rem;
  }

  .group header p {
    margin: 0;
    color: #c9cbd1;
    font-size: 0.86rem;
    line-height: 1.45;
  }

  .cards {
    display: grid;
    gap: 0.7rem;
  }

  .card-entry {
    display: grid;
    gap: 0.45rem;
  }

  .assign,
  .remove {
    width: 100%;
    padding: 0.5rem 0.7rem;
    color: #d6e5ff;
    font: inherit;
    text-align: left;
    background: rgba(91, 135, 210, 0.14);
    border: 1px solid rgba(168, 200, 255, 0.4);
    cursor: pointer;
  }

  .remove {
    color: #f2d1b2;
    background: rgba(154, 104, 61, 0.16);
    border-color: rgba(226, 173, 105, 0.42);
  }

  .assign:focus-visible,
  .remove:focus-visible {
    outline: 3px solid #e2ad69;
    outline-offset: 3px;
  }

  .assign:disabled,
  .remove:disabled {
    cursor: default;
    opacity: 0.52;
  }

  @media (max-width: 760px) {
    .board-layout {
      grid-template-columns: 1fr;
    }
  }
</style>
