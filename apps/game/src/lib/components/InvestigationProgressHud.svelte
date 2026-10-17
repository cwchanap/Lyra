<script lang="ts">
  import type { InvestigationProgressView } from "../state/types";

  let { progress }: { progress: InvestigationProgressView | null } = $props();

  let remaining = $derived(progress ? progress.total - progress.done : 0);
</script>

{#if progress && progress.total > 0}
  <section class="investigation-progress" role="status" aria-label="調查進度">
    <p class="eyebrow">調查進度 / PROGRESS</p>
    <p class="count">
      <strong>{progress.done}</strong>
      <span class="slash">/</span>
      <span>{progress.total}</span>
    </p>
    <p class="hint">
      {#if remaining > 0}
        尚有 {remaining} 項未查。查完所有線索與詢問後自動前進。
      {:else}
        調查完畢。
      {/if}
    </p>
  </section>
{/if}

<style>
  .investigation-progress {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    column-gap: 12px;
    row-gap: 2px;
    max-width: min(100%, 360px);
    padding: 8px 12px;
    border-left: 2px solid var(--cyan);
    background: color-mix(in srgb, var(--ink) 82%, transparent);
    color: var(--bone);
    pointer-events: none;
  }

  .eyebrow,
  .count,
  .hint {
    margin: 0;
  }

  .eyebrow {
    grid-column: 1 / -1;
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
  }

  .count {
    font-family: var(--mono);
    font-size: 15px;
    letter-spacing: 0.06em;
    white-space: nowrap;
  }

  .count strong {
    color: var(--cyan);
    font-weight: 500;
  }

  .slash {
    color: var(--bone-faint);
  }

  .hint {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12px;
    line-height: 1.5;
    line-break: strict;
  }
</style>
