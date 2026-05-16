<script lang="ts">
  import type { HotspotView } from "../state/types";
  let { hotspots, onInspect }: { hotspots: HotspotView[]; onInspect: (id: string) => void } = $props();
</script>

<section class="grid">
  {#each hotspots as h}
    <button class:done={h.inspected} type="button" onclick={() => onInspect(h.id)}>
      <strong>{h.label}</strong>
      <small>{h.description}</small>
    </button>
  {/each}
</section>

<style>
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
    gap: 12px; padding: 12px 24px;
  }
  button {
    text-align: left; padding: 14px; background: #161b22; color: #e6edf3;
    border: 1px solid #30363d; border-radius: 10px; cursor: pointer; font: inherit;
  }
  button:hover { border-color: #58a6ff; }
  button.done { opacity: 0.75; }
  strong { display: block; margin-bottom: 6px; }
  small { color: #8b949e; }
</style>
