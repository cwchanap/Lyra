<script lang="ts">
  import GameShell from "./GameShell.svelte";
  import type { GameStateView } from "$lib/state/types";

  let {
    gameState,
    onReset,
    disabled = false,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    disabled?: boolean;
  } = $props();
</script>

<GameShell {gameState} {onReset} {disabled}>
  <p class="shell-content">scoped child</p>
</GameShell>
