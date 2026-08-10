<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import type { SceneView } from "$lib/state/types";

  let {
    scene,
    boardId,
    feedback,
    onSelection,
    onSubmit,
    disabled = false,
  }: {
    scene: SceneView;
    boardId: string;
    feedback: string | null;
    onSelection: (boardId: string, cardIds: string[]) => Promise<void>;
    onSubmit: (boardId: string) => Promise<void>;
    disabled?: boolean;
  } = $props();

  let analysis = $derived(scene.kind === "analysis" ? scene : null);
  let board = $derived(
    analysis?.visibleBoards.find((candidate) => candidate.id === boardId),
  );

  async function toggleCard(cardId: string) {
    if (!board || disabled) return;
    const selected = new SvelteSet(board.selectedCardIds);
    if (selected.has(cardId)) selected.delete(cardId);
    else selected.add(cardId);
    try {
      await onSelection(board.id, [...selected]);
    } catch (error) {
      console.warn("[Analysis] Selection failed", error);
    }
  }

  async function submit(): Promise<void> {
    if (!board || disabled || board.completed) return;
    try {
      await onSubmit(board.id);
    } catch (error) {
      console.warn("[Analysis] Submission failed", error);
    }
  }
</script>

<section class="analysis-view" aria-label="分析板">
  {#if board}
    <header>
      <p class="eyebrow">推理練習</p>
      <h2>{board.label}</h2>
      <p>{board.prompt}</p>
    </header>

    <div class="cards" aria-label="可選線索">
      {#each board.cards as card (card.id)}
        {@const selected = board.selectedCardIds.includes(card.id)}
        <button
          type="button"
          class:selected
          disabled={disabled || !card.available || board.completed}
          aria-pressed={selected}
          onclick={() => toggleCard(card.id)}
        >
          <strong>{card.label}</strong>
          <span>{card.summary}</span>
        </button>
      {/each}
    </div>

    {#if feedback}
      <p class="feedback" role="status">{feedback}</p>
    {/if}

    <footer>
      <span
        >已選 {board.selectedCardIds.length} / 至少 {board.minimumSelected}</span
      >
      <button
        type="button"
        class="submit"
        disabled={disabled || board.completed}
        onclick={submit}
      >
        比對推論
      </button>
    </footer>
  {:else}
    <p class="feedback">分析板載入中。</p>
  {/if}
</section>

<style>
  .analysis-view {
    width: min(720px, calc(100vw - 2rem));
    margin: 4rem auto;
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
  h2 {
    margin: 0;
    font-size: clamp(1.25rem, 3vw, 1.8rem);
  }
  .eyebrow {
    color: #9cb6df;
    font-size: 0.82rem;
    letter-spacing: 0.13em;
  }
  .cards {
    display: grid;
    gap: 0.7rem;
    margin: 1.5rem 0;
  }
  .cards button {
    display: grid;
    gap: 0.25rem;
    width: 100%;
    padding: 0.9rem 1rem;
    text-align: left;
    color: inherit;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(179, 191, 214, 0.28);
    cursor: pointer;
  }
  .cards button.selected {
    border-color: #a8c8ff;
    background: rgba(91, 135, 210, 0.28);
  }
  .cards button:disabled {
    cursor: default;
    opacity: 0.52;
  }
  .cards span {
    color: #c9cbd1;
    font-size: 0.9rem;
  }
  .feedback {
    margin: 1rem 0;
    padding: 0.85rem 1rem;
    background: rgba(154, 104, 61, 0.25);
    border-left: 3px solid #e2ad69;
  }
  footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    color: #c9cbd1;
  }
  .submit {
    padding: 0.6rem 1rem;
    color: #11151c;
    font-weight: 700;
    background: #b9cef1;
    border: 0;
    cursor: pointer;
  }
  .submit:disabled {
    cursor: default;
    opacity: 0.5;
  }
</style>
