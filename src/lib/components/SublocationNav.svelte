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

<nav class="nav">
  {#each sublocations as sub (sub.id)}
    <button
      class:active={sub.id === currentId}
      {disabled}
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
  button:disabled { opacity: 0.6; cursor: wait; }
</style>
