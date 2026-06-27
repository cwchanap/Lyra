<script lang="ts">
  import GameShell from "./GameShell.svelte";
  import type { GameStateView } from "$lib/state/types";

  let {
    gameState,
    onReset,
    disabled = false,
    menuContent = null,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    disabled?: boolean;
    menuContent?: string | null;
  } = $props();
</script>

<GameShell {gameState} {onReset} {disabled}>
  {#snippet menu()}
    {#if menuContent}
      <p>{menuContent}</p>
    {/if}
  {/snippet}

  <p class="shell-content">scoped child</p>
</GameShell>
