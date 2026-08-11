<script lang="ts">
  import type { AnalysisCardView } from "$lib/state/types";

  let {
    card,
    badges = [],
    badge = null,
    selected = false,
    disabled = false,
    readOnly = false,
    unavailableLabel = "尚未取得",
    onSelect,
  }: {
    card: AnalysisCardView;
    badges?: readonly string[];
    badge?: string | null;
    selected?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    unavailableLabel?: string;
    onSelect?: () => void;
  } = $props();

  let allBadges = $derived(badge ? [badge, ...badges] : [...badges]);
  let interactive = $derived(onSelect !== undefined && !readOnly);
  let unavailable = $derived(!card.available);
</script>

{#if interactive}
  <button
    type="button"
    class="analysis-card"
    class:selected
    class:unavailable
    disabled={disabled || unavailable || readOnly}
    aria-pressed={selected}
    aria-label={`選取：${card.label}`}
    onclick={() => onSelect?.()}
  >
    <span class="card-copy">
      <strong>{card.label}</strong>
      <span>{card.summary}</span>
    </span>
    {#if allBadges.length > 0}
      <span class="badges" aria-label="卡片標籤">
        {#each allBadges as cardBadge (cardBadge)}
          <span class="badge">{cardBadge}</span>
        {/each}
      </span>
    {/if}
    {#if unavailable}
      <span class="availability">{unavailableLabel}</span>
    {/if}
  </button>
{:else}
  <article class="analysis-card" class:selected class:unavailable>
    <span class="card-copy">
      <strong>{card.label}</strong>
      <span>{card.summary}</span>
    </span>
    {#if allBadges.length > 0}
      <span class="badges" aria-label="卡片標籤">
        {#each allBadges as cardBadge (cardBadge)}
          <span class="badge">{cardBadge}</span>
        {/each}
      </span>
    {/if}
    {#if unavailable}
      <span class="availability">{unavailableLabel}</span>
    {:else if readOnly}
      <span class="availability">僅供檢視</span>
    {/if}
  </article>
{/if}

<style>
  .analysis-card {
    display: grid;
    gap: 0.45rem;
    width: 100%;
    padding: 0.85rem 1rem;
    color: inherit;
    text-align: left;
    background: rgba(255, 255, 255, 0.045);
    border: 1px solid rgba(179, 191, 214, 0.3);
    font: inherit;
    transition:
      transform 0.18s ease,
      background-color 0.18s ease,
      border-color 0.18s ease;
  }

  button.analysis-card {
    cursor: pointer;
  }

  button.analysis-card:hover:not(:disabled),
  button.analysis-card:focus-visible:not(:disabled) {
    transform: translateY(-1px);
    background: rgba(91, 135, 210, 0.2);
    border-color: #a8c8ff;
  }

  button.analysis-card:focus-visible {
    outline: 3px solid #e2ad69;
    outline-offset: 3px;
  }

  .analysis-card.selected {
    background: rgba(91, 135, 210, 0.28);
    border-color: #a8c8ff;
  }

  .analysis-card.unavailable,
  button.analysis-card:disabled {
    cursor: default;
    opacity: 0.52;
  }

  .card-copy {
    display: grid;
    gap: 0.25rem;
  }

  .card-copy strong {
    font-size: 1rem;
  }

  .card-copy span {
    color: #c9cbd1;
    font-size: 0.9rem;
    line-height: 1.5;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.35rem;
  }

  .badge {
    padding: 0.14rem 0.4rem;
    color: #d6e5ff;
    background: rgba(91, 135, 210, 0.28);
    border: 1px solid rgba(168, 200, 255, 0.45);
    font-size: 0.75rem;
  }

  .availability {
    color: #e2ad69;
    font-size: 0.8rem;
  }

  @media (prefers-reduced-motion: reduce) {
    .analysis-card {
      transition: none;
    }
  }
</style>
