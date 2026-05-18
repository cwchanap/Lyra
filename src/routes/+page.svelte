<script lang="ts">
  import { onMount } from "svelte";
  import {
    gameState,
    startGame,
    resetGame,
    advanceDialogue,
    inspectHotspot,
    interviewTopic,
    enterSublocation,
    reexamineEvidence,
    reexamineStatement,
  } from "$lib/state/game-client.svelte";
  import { canReexamineInventory, shouldShowInventoryPanel } from "$lib/state/mode";
  import DialogueBox from "$lib/components/DialogueBox.svelte";
  import ExploreView from "$lib/components/ExploreView.svelte";
  import SceneBackdrop from "$lib/components/SceneBackdrop.svelte";
  import GameShell from "$lib/components/GameShell.svelte";
  import InventoryPanel from "$lib/components/InventoryPanel.svelte";
  import ErrorBanner from "$lib/components/ErrorBanner.svelte";
  import GameComplete from "$lib/components/GameComplete.svelte";

  onMount(() => {
    void startGame();
  });
</script>

{#if gameState.loading}
  <main><p class="status">Loading…</p></main>
{:else if gameState.value}
  <GameShell gameState={gameState.value} onReset={resetGame}>
    {#if gameState.error}
      <ErrorBanner message={gameState.error} />
    {/if}
    {#if gameState.value.mode.type === "dialogue"}
      <SceneBackdrop sceneTag={gameState.value.mode.sceneTag} />
      <DialogueBox
        current={gameState.value.mode.current}
        queueToken={gameState.value.mode.queueToken}
        onAdvance={advanceDialogue}
      />
    {:else if gameState.value.mode.type === "explore"}
      <ExploreView
        scene={gameState.value.scene}
        onInspect={inspectHotspot}
        onInterview={interviewTopic}
        onEnterSublocation={enterSublocation}
      />
    {:else if gameState.value.mode.type === "gameComplete"}
      <GameComplete onReset={resetGame} />
    {/if}
    {#if shouldShowInventoryPanel(gameState.value.mode)}
      <InventoryPanel
        inventory={gameState.value.inventory}
        reexamineEnabled={canReexamineInventory(gameState.value.mode)}
        onReexamineEvidence={reexamineEvidence}
        onReexamineStatement={reexamineStatement}
      />
    {/if}
  </GameShell>
{:else if gameState.error}
  <main>
    <ErrorBanner message={gameState.error} />
    <button onclick={startGame} type="button">Retry</button>
  </main>
{/if}

<style>
  :global(body) {
    margin: 0;
    background: #0d1117;
    color: #e6edf3;
    font-family: Inter, system-ui, -apple-system, sans-serif;
    min-height: 100vh;
  }
  .status { padding: 32px; color: #8b949e; }
</style>
