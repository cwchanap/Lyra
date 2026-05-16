<script lang="ts">
  let { sceneTag }: { sceneTag: string | null } = $props();
</script>

{#if sceneTag}
  <div class="backdrop">
    <span class="tag">場景：{sceneTag}</span>
  </div>
{/if}

<style>
  .backdrop {
    padding: 12px 24px;
    background: linear-gradient(180deg, #0d1117 0%, #1a1f2a 100%);
    color: #d0d7de;
    border-bottom: 1px solid #30363d;
  }
  .tag {
    font-size: 0.85rem;
    font-style: italic;
    opacity: 0.85;
  }
</style>
