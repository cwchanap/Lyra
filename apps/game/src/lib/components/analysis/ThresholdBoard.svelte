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

  <footer>
    <span>已選 {selectedCardIds.length} / 至少 {board.minimumSelected}</span>
  </footer>
</section>

<style>
  .threshold-board {
    display: grid;
    gap: 1.25rem;
    color: #efedf0;
    min-width: 0;
  }

  .cards {
    display: grid;
    gap: 0.7rem;
  }

  .card-entry {
    display: grid;
    gap: 0.45rem;
  }

  .provenance {
    display: grid;
    gap: 0.2rem;
    padding: 0.65rem 0.8rem;
    color: #c9cbd1;
    background: rgba(255, 255, 255, 0.025);
    border-left: 2px solid rgba(168, 200, 255, 0.45);
    font-size: 0.84rem;
  }

  .provenance p {
    margin: 0;
    line-height: 1.45;
  }

  footer {
    display: flex;
    justify-content: flex-end;
    color: #c9cbd1;
  }
</style>
