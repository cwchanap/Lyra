<script lang="ts">
  import type { SublocationView } from "../state/types";

  let {
    sublocations,
    currentId,
    onEnter,
  }: {
    sublocations: SublocationView[];
    currentId: string | null;
    onEnter: (id: string) => void;
  } = $props();
</script>

<nav class="nav">
  {#each sublocations as sub}
    <button
      class:active={sub.id === currentId}
      onclick={() => onEnter(sub.id)}
      type="button"
    >
      {sub.label}
    </button>
  {/each}
</nav>

<style>
  .nav { display: flex; gap: 8px; padding: 12px 24px; }
  button {
    padding: 8px 14px; border: 1px solid #30363d; border-radius: 999px;
    background: #161b22; color: #d0d7de; cursor: pointer; font: inherit;
  }
  button.active { border-color: #58a6ff; background: #0c2d6b; }
</style>
