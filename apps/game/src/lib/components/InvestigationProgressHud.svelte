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
      {#if remaining > 0}
        <span class="sr-only">，尚有 {remaining} 項未查</span>
      {/if}
    </p>
    <!-- Kept to one short line: the panel sits above the scene's hotspots
         (scene-hud z-index 9 over targets at 4), so every extra line hides
         more of the top-right art and any pending markers under it. -->
    <p class="hint">{remaining > 0 ? "全部查完後自動前進" : "調查完畢"}</p>
  </section>
{/if}

<style>
  .investigation-progress {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: baseline;
    column-gap: 12px;
    row-gap: 2px;
    max-width: 100%;
    padding: 6px 12px;
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
    white-space: nowrap;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }
</style>
