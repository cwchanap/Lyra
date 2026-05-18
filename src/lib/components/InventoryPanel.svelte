<script lang="ts">
  import type { Inventory } from "../state/types";
  let { inventory, onReexamineEvidence, onReexamineStatement }: {
    inventory: Inventory;
    onReexamineEvidence: (id: string) => void;
    onReexamineStatement: (id: string) => void;
  } = $props();
  let open = $state(false);
</script>

<aside class:open>
  <button class="toggle" type="button" onclick={() => (open = !open)}>
    📋 {open ? "Hide" : "Inventory"} (證 {inventory.evidence.length} · 言 {inventory.statements.length})
  </button>
  {#if open}
    <div class="panel">
      <section>
        <h3>證物 ({inventory.evidence.length})</h3>
        {#if inventory.evidence.length === 0}
          <p class="empty">尚未收集。</p>
        {/if}
        {#each inventory.evidence as e}
          <button type="button" onclick={() => onReexamineEvidence(e.id)}>
            <strong>{e.name}</strong>
            <small>{e.description}</small>
          </button>
        {/each}
      </section>
      <section>
        <h3>證言 ({inventory.statements.length})</h3>
        {#if inventory.statements.length === 0}
          <p class="empty">尚未取得。</p>
        {/if}
        {#each inventory.statements as s}
          <button type="button" onclick={() => onReexamineStatement(s.id)}>
            <strong>{s.speaker}</strong>
            <small>{s.content}</small>
          </button>
        {/each}
      </section>
    </div>
  {/if}
</aside>

<style>
  aside { position: fixed; top: 24px; right: 24px; width: 320px; pointer-events: none; }
  .toggle { pointer-events: auto; padding: 8px 14px; background: #161b22; color: #e6edf3; border: 1px solid #30363d; border-radius: 999px; cursor: pointer; font: inherit; }
  .panel { pointer-events: auto; margin-top: 8px; padding: 14px; background: #0d1117; border: 1px solid #30363d; border-radius: 10px; max-height: 70vh; overflow-y: auto; }
  h3 { margin: 12px 0 8px; color: #e6edf3; font-size: 0.9rem; }
  section button { display: block; width: 100%; text-align: left; padding: 8px 10px; margin-bottom: 6px; background: #161b22; border: 1px solid #30363d; border-radius: 6px; color: #d0d7de; cursor: pointer; font: inherit; }
  section button:hover { border-color: #58a6ff; }
  section button strong { display: block; color: #58a6ff; }
  section button small { color: #8b949e; }
  .empty { color: #8b949e; font-size: 0.85rem; }
</style>
