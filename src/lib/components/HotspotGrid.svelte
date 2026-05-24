<script lang="ts">
  import type { HotspotView } from "../state/types";

  let {
    hotspots,
    onInspect,
    disabled = false,
  }: {
    hotspots: HotspotView[];
    onInspect: (id: string) => void;
    disabled?: boolean;
  } = $props();
</script>

<section class="section">
  <header class="section-header">
    <span class="eyebrow">線索 · HOTSPOTS</span>
    <span class="count">{hotspots.filter((h) => h.inspected).length} / {hotspots.length}</span>
  </header>

  <div class="grid">
    {#each hotspots as h, i (h.id)}
      <button
        class="card"
        class:done={h.inspected}
        type="button"
        {disabled}
        onclick={() => onInspect(h.id)}
      >
        <span class="num">{String(i + 1).padStart(2, "0")}</span>
        <div class="body">
          <strong>{h.label}</strong>
          <small>{h.description}</small>
        </div>
        {#if h.inspected}
          <span class="stamp">已調查</span>
        {/if}
      </button>
    {/each}
  </div>
</section>

<style>
  .section {
    padding: 8px clamp(20px, 3vw, 40px) 12px;
  }

  .section-header {
    display: flex;
    align-items: baseline;
    gap: 14px;
    margin-bottom: 10px;
  }

  .eyebrow {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
  }

  .count {
    font-family: var(--mono);
    font-size: 11px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
    gap: 12px;
  }

  .card {
    position: relative;
    display: grid;
    grid-template-columns: 44px 1fr;
    gap: 14px;
    padding: 14px 16px;
    background: var(--char);
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    text-align: left;
    clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
    transition: transform 0.18s, background 0.18s, border-color 0.18s;
  }

  .card::before {
    content: "";
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 2px;
    background: var(--crimson);
    transform: scaleY(0);
    transform-origin: top center;
    transition: transform 0.22s cubic-bezier(0.6, 0, 0.3, 1);
  }

  .card:hover:not(:disabled)::before,
  .card:focus-visible:not(:disabled)::before {
    transform: scaleY(1);
  }

  .card:hover:not(:disabled),
  .card:focus-visible:not(:disabled) {
    transform: translateX(-2px);
    background: var(--char-2);
    border-color: rgba(212, 20, 58, 0.4);
  }

  .card:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .card.done {
    opacity: 0.72;
  }

  .num {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 28px;
    color: var(--bone-dim);
    line-height: 1;
  }

  .card:hover:not(:disabled) .num,
  .card:focus-visible:not(:disabled) .num {
    color: var(--crimson);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  strong {
    display: block;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 15px;
    letter-spacing: 0.08em;
    color: var(--bone);
  }

  small {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12.5px;
    line-height: 1.5;
  }

  .stamp {
    position: absolute;
    right: 8px;
    top: 8px;
    padding: 3px 6px 2px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 9px;
    letter-spacing: 0.24em;
    color: var(--bone-faint);
    border: 1px solid var(--bone-faint);
    text-transform: uppercase;
    transform: rotate(-4deg);
  }
</style>
