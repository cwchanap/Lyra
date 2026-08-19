<script lang="ts">
  import { SvelteSet } from "svelte/reactivity";
  import { caseRecordProvenancePresentation } from "$lib/case-file/provenance-badges";
  import type {
    Inventory,
    AnalysisBoardView,
    AnalysisDraft,
  } from "$lib/state/types";
  import AnalysisCard from "./AnalysisCard.svelte";

  type ThresholdBoardView = Extract<AnalysisBoardView, { kind: "threshold" }>;
  type ThresholdDraft = Extract<AnalysisDraft, { kind: "threshold" }>;

  let {
    board,
    inventory,
    onDraft,
    disabled = false,
    readOnly = false,
  }: {
    board: ThresholdBoardView;
    inventory: Inventory;
    onDraft: (draft: ThresholdDraft, focusKey: string) => void | Promise<void>;
    disabled?: boolean;
    readOnly?: boolean;
  } = $props();

  let selectedCardIds = $derived(
    board.draft.kind === "threshold" ? board.draft.selectedCardIds : [],
  );
  let editable = $derived(
    board.draft.kind === "threshold" &&
      !disabled &&
      !readOnly &&
      board.available &&
      !board.completed &&
      !board.readOnly,
  );
  let pending = $state(false);

  function recordForCard(card: ThresholdBoardView["cards"][number]) {
    if (card.source.kind === "evidence") {
      return (
        inventory.evidence.find((record) => record.id === card.source.id) ??
        null
      );
    }
    if (card.source.kind === "statement") {
      return (
        inventory.statements.find((record) => record.id === card.source.id) ??
        null
      );
    }
    return null;
  }

  async function toggleCard(cardId: string) {
    /* v8 ignore next -- unreachable: onSelect is undefined when not editable */
    if (!editable || pending || board.draft.kind !== "threshold") return;
    const card = board.cards.find((candidate) => candidate.id === cardId);
    /* v8 ignore next -- unreachable: AnalysisCard does not expose a clickable toggle for unavailable cards */
    if (!card || !card.available) return;

    const selected = new SvelteSet(board.draft.selectedCardIds);
    if (selected.has(cardId)) selected.delete(cardId);
    else selected.add(cardId);

    pending = true;
    try {
      await onDraft(
        {
          kind: "threshold",
          selectedCardIds: [...selected].sort(),
        },
        `card:${cardId}`,
      );
    } catch {
      // Selection is derived from board.draft; nothing local to restore.
    } finally {
      pending = false;
    }
  }
</script>

<section class="threshold-board" aria-label="門檻板">
  <div class="cards" aria-label="可選線索">
    {#each board.cards as card (card.id)}
      {@const record = recordForCard(card)}
      {@const provenance = record
        ? caseRecordProvenancePresentation(record)
        : null}
      <article class="card-entry">
        <AnalysisCard
          {card}
          badge={selectedCardIds.includes(card.id) ? "已選" : null}
          selected={selectedCardIds.includes(card.id)}
          disabled={!editable || pending}
          readOnly={!editable}
          onSelect={editable && !pending
            ? () => toggleCard(card.id)
            : undefined}
        />

        {#if provenance !== null}
          <div class="provenance" aria-label={`來源與狀態：${card.label}`}>
            {#if provenance.sourceKind}<p>
                來源類型：{provenance.sourceKind}
              </p>{/if}
            {#if provenance.proceduralStatus}<p>
                程序狀態：{provenance.proceduralStatus}
              </p>{/if}
            {#if provenance.source}<p>來源：{provenance.source}</p>{/if}
            {#if provenance.sourceGroup}<p>
                來源群組：{provenance.sourceGroup}
              </p>{/if}
            {#if provenance.proofCapabilities}<p>
                可證明：{provenance.proofCapabilities}
              </p>{/if}
          </div>
        {/if}
      </article>
    {/each}
  </div>

  <footer aria-label="門檻選取進度">
    <span>已選 {selectedCardIds.length} / 至少 {board.minimumSelected}</span>
    <progress
      max={board.minimumSelected}
      value={selectedCardIds.length}
      aria-label="門檻選取進度"
      >{selectedCardIds.length} / {board.minimumSelected}</progress
    >
  </footer>
</section>

<style>
  .threshold-board {
    display: grid;
    gap: 1.25rem;
    min-width: 0;
    color: var(--bone);
    font-family: var(--body-jp);
  }

  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
    gap: 0.75rem;
    min-width: 0;
  }

  .card-entry {
    display: grid;
    gap: 0.35rem;
    min-width: 0;
    align-content: start;
  }

  .provenance {
    display: grid;
    gap: 0.15rem;
    min-width: 0;
    padding: 0.45rem 0.6rem;
    overflow-wrap: anywhere;
    color: var(--bone-dim);
    background: var(--cyan-soft);
    border-left: 2px solid var(--cyan);
    clip-path: polygon(0 0, calc(100% - 8px) 0, 100% 8px, 100% 100%, 0 100%);
    font-family: var(--serif-jp);
    font-size: 0.7rem;
    line-height: 1.35;
  }

  .provenance p {
    margin: 0;
    line-height: inherit;
  }

  footer {
    display: grid;
    gap: 0.35rem;
    color: var(--bone-dim);
    font-family: var(--impact);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
  }

  footer progress {
    width: 100%;
    height: 0.36rem;
    accent-color: var(--cyan);
  }

  @media (max-width: 720px) {
    .cards {
      grid-template-columns: 1fr;
    }
  }
</style>
