<script lang="ts">
  import type { SublocationView } from "../state/types";

  let {
    sublocations,
    currentId,
    onEnter,
    disabled = false,
  }: {
    sublocations: SublocationView[];
    currentId: string | null;
    onEnter: (id: string) => void;
    disabled?: boolean;
  } = $props();
</script>

<nav class="nav" aria-label="地點導航">
  <span class="eyebrow">地點 · LOCATIONS</span>
  <div class="chips">
    {#each sublocations as sub, i (sub.id)}
      <button
        class:active={sub.id === currentId}
        {disabled}
        onclick={() => onEnter(sub.id)}
        type="button"
      >
        <span class="idx">{String(i + 1).padStart(2, "0")}</span>
        <span class="label">{sub.label}</span>
        {#if sub.id === currentId}
          <span class="active-mark">▸</span>
        {/if}
      </button>
    {/each}
  </div>
</nav>

<style>
  .nav {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px clamp(20px, 3vw, 40px);
    flex-wrap: wrap;
  }

  .eyebrow {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
    padding-right: 14px;
    border-right: 1px solid var(--rule-strong);
  }

  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 7px;
    background: transparent;
    color: var(--bone-dim);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
    transition:
      color 0.18s,
      border-color 0.18s,
      background 0.18s;
  }

  button:hover:not(:disabled) {
    color: var(--bone);
    border-color: var(--bone-dim);
  }

  button.active {
    color: var(--bone);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .idx {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
  }

  button.active .idx {
    color: var(--crimson);
  }

  .active-mark {
    color: var(--crimson);
    font-size: 11px;
  }
</style>
