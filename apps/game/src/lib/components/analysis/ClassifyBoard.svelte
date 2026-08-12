<script lang="ts">
  import type { AnalysisBoardView, AnalysisDraft } from "$lib/state/types";
  import AnalysisCard from "./AnalysisCard.svelte";

  type ClassifyBoardView = Extract<AnalysisBoardView, { kind: "classify" }>;
  type ClassifyDraft = Extract<AnalysisDraft, { kind: "classify" }>;

  let {
    board,
    headingFocusKey = null,
    onDraft,
    disabled = false,
    readOnly = false,
  }: {
    board: ClassifyBoardView;
    headingFocusKey?: string | null;
    onDraft: (draft: ClassifyDraft, focusKey: string) => void | Promise<void>;
    disabled?: boolean;
    readOnly?: boolean;
  } = $props();

  let selectedCardId = $state<string | null>(null);
  let pending = $state(false);
  let editable = $derived(
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

  async function assignCard(groupId: string) {
    /* v8 ignore next -- unreachable: assign button only rendered when editable */
    if (!editable || pending) return;
    if (board.draft.kind !== "classify") {
      return;
    }
    const cardId = selectedCardId;
    /* v8 ignore next -- unreachable: assign button disabled when no card selected */
    if (!cardId) return;
    const card = board.cards.find((candidate) => candidate.id === cardId);
    /* v8 ignore next -- unreachable: assign button disabled for unavailable selection */
    if (!card || !card.available) return;

    pending = true;
    try {
      await onDraft(
        {
          kind: "classify",
          groupByCard: {
            ...board.draft.groupByCard,
            [cardId]: groupId,
          },
        },
        `card:${cardId}`,
      );
      selectedCardId = null;
    } catch {
      // Preserve the current selection so the player can retry.
    } finally {
      pending = false;
    }
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

    const groupByCard = { ...board.draft.groupByCard };
    delete groupByCard[cardId];
    pending = true;
    try {
      await onDraft({ kind: "classify", groupByCard }, `card:${cardId}`);
      if (selectedCardId === cardId) selectedCardId = null;
    } catch {
      // Preserve the current selection so the player can retry.
    } finally {
      pending = false;
    }
  }
</script>

<section class="classify-board" aria-label="分類板">
  <header>
    <p class="eyebrow">證據分類</p>
    <h2 data-analysis-focus-key={headingFocusKey ?? undefined} tabindex="-1">
      {board.label}
    </h2>
    <p>{board.prompt}</p>
  </header>

  {#if board.hint}<p class="hint">提示：{board.hint}</p>{/if}

  <div class="board-layout">
    <section class="card-pool" aria-label="未分類卡片">
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
                disabled={!editable || pending}
                readOnly={!editable}
                onSelect={editable && !pending
                  ? () => selectCard(card.id)
                  : undefined}
              />
            </div>
          {/each}
        </div>
      {/if}
    </section>

    <div class="groups" aria-label="分類分組">
      {#each board.groups as group (group.id)}
        {@const groupCards = cardsForGroup(group.id)}
        <section class="group" aria-labelledby={`group-${group.id}`}>
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
                    disabled={!editable || pending}
                    readOnly={!editable}
                    onSelect={editable && !pending
                      ? () => selectCard(card.id)
                      : undefined}
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
  .classify-board {
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
  .empty {
    margin: 0;
    color: #c9cbd1;
    font-size: 0.9rem;
  }

  .hint {
    padding: 0.7rem 0.85rem;
    background: rgba(91, 135, 210, 0.14);
    border-left: 3px solid #a8c8ff;
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
