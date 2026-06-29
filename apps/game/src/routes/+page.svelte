<script lang="ts">
  import {
    gameState,
    startGame,
    resetGame,
    returnToMainMenu,
    advanceDialogue,
    inspectHotspot,
    interviewTopic,
    enterSublocation,
    reexamineEvidence,
    reexamineStatement,
    answerInterrogationQuestion,
    pressTestimonyStatement,
    presentTestimonyItem,
    listScenes,
    jumpToScene,
  } from "$lib/state/game-client.svelte";
  import {
    canReexamineInventory,
    shouldShowInventoryPanel,
  } from "$lib/state/mode";
  import {
    loadStoryClearedOnce,
    saveStoryClearedOnce,
  } from "$lib/state/story-clearance";
  import type { SceneNavigationIndex } from "$lib/state/types";
  import DialogueBox from "$lib/components/DialogueBox.svelte";
  import ExploreView from "$lib/components/ExploreView.svelte";
  import SceneBackdrop from "$lib/components/SceneBackdrop.svelte";
  import SceneNavigationPanel from "$lib/components/SceneNavigationPanel.svelte";
  import GameShell from "$lib/components/GameShell.svelte";
  import InventoryPanel from "$lib/components/InventoryPanel.svelte";
  import ErrorBanner from "$lib/components/ErrorBanner.svelte";
  import GameComplete from "$lib/components/GameComplete.svelte";
  import GameplayAudio from "$lib/components/GameplayAudio.svelte";
  import InterrogationView from "$lib/components/InterrogationView.svelte";
  import MainMenu from "$lib/components/MainMenu.svelte";
  import { playGameplaySfxEvent } from "$lib/audio/gameplay-audio-runtime.svelte";

  async function handleExit() {
    try {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      await getCurrentWindow().close();
    } catch (e) {
      console.warn("Window close unavailable in this runtime:", e);
    }
  }

  // Hoisted so the dossier expand/collapse survives the Escape menu
  // close/reopen. The panel mounts only while the menu is open; this state
  // lives on the page (which does not unmount on menu toggle), and
  // bind:open keeps the panel in sync with it.
  let inventoryPanelOpen = $state(false);
  // Bound to GameShell so dossier reexamine can close the Escape menu
  // programmatically (see handleReexamine*).
  let gameMenuOpen = $state(false);
  let storyClearedOnce = $state(loadStoryClearedOnce());
  let sceneNavigationIndex = $state<SceneNavigationIndex | null>(null);
  let sceneNavigationLoading = $state(false);
  let sceneNavigationRequested = $state(false);
  let sceneNavigationEnabled = $derived(
    import.meta.env.DEV || storyClearedOnce,
  );

  $effect(() => {
    if (gameState.value?.mode.type === "gameComplete" && !storyClearedOnce) {
      storyClearedOnce = true;
      saveStoryClearedOnce();
    }
  });

  $effect(() => {
    if (
      sceneNavigationEnabled &&
      gameState.value &&
      !sceneNavigationIndex &&
      !sceneNavigationLoading &&
      !sceneNavigationRequested
    ) {
      sceneNavigationRequested = true;
      void loadSceneNavigationIndex();
    }
  });

  async function loadSceneNavigationIndex() {
    sceneNavigationLoading = true;
    const index = await listScenes();
    if (index) {
      sceneNavigationIndex = index;
    }
    sceneNavigationLoading = false;
  }

  async function handleReset() {
    await resetGame();
    if (gameState.error) {
      return;
    }
    gameState.error = null;
  }

  function handleCloseCase() {
    returnToMainMenu();
  }

  // Reexamine from the dossier (inside the Escape menu) installs a dialogue
  // queue and flips the mode to dialogue. If the menu stayed mounted, its
  // scrim (z-index 40) would hide the dialogue (z-index 30, in <main inert>)
  // until the player manually resumed. Close the menu once the command
  // resolves so the mode→dialogue change and the menu close batch into one
  // render — no flash — and on error the menu still closes so the ErrorBanner
  // (rendered in <main>) is visible instead of trapped behind the scrim.
  async function handleReexamineEvidence(evidenceId: string) {
    await reexamineEvidence(evidenceId);
    gameMenuOpen = false;
  }
  async function handleReexamineStatement(statementId: string) {
    await reexamineStatement(statementId);
    gameMenuOpen = false;
  }

  async function handleJumpToScene(chapterId: string, sceneId: string) {
    await jumpToScene(chapterId, sceneId);
    gameMenuOpen = false;
  }
</script>

{#if gameState.value}
  <GameplayAudio mode={gameState.value.mode} />
  <GameShell
    gameState={gameState.value}
    onCloseCase={handleCloseCase}
    disabled={gameState.inFlight}
    sceneMenuEnabled={sceneNavigationEnabled}
    bind:open={gameMenuOpen}
  >
    {#snippet sceneMenu()}
      <SceneNavigationPanel
        index={sceneNavigationIndex}
        current={gameState.value!}
        loading={sceneNavigationLoading}
        disabled={gameState.inFlight}
        onSelect={handleJumpToScene}
      />
    {/snippet}

    {#snippet menu()}
      {#if shouldShowInventoryPanel(gameState.value!.mode)}
        <InventoryPanel
          inventory={gameState.value!.inventory}
          reexamineEnabled={canReexamineInventory(gameState.value!.mode)}
          onReexamineEvidence={handleReexamineEvidence}
          onReexamineStatement={handleReexamineStatement}
          disabled={gameState.inFlight}
          bind:open={inventoryPanelOpen}
        />
      {/if}
    {/snippet}

    {#if gameState.error}
      <ErrorBanner message={gameState.error} />
    {/if}
    {#if gameState.value.mode.type === "dialogue"}
      <SceneBackdrop
        sceneTag={gameState.value.mode.sceneTag}
        backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
      />
      <DialogueBox
        current={gameState.value.mode.current}
        queueToken={gameState.value.mode.queueToken}
        onAdvance={advanceDialogue}
        onAdvanceFeedback={() => playGameplaySfxEvent("ui:menu-confirm")}
        disabled={gameState.inFlight}
      />
    {:else if gameState.value.mode.type === "explore"}
      <ExploreView
        scene={gameState.value.scene}
        backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
        onInspect={inspectHotspot}
        onInterview={interviewTopic}
        onEnterSublocation={enterSublocation}
        disabled={gameState.inFlight}
      />
    {:else if gameState.value.mode.type === "interrogation"}
      <SceneBackdrop
        sceneTag={null}
        backgroundAssetId={gameState.value.mode.backgroundAssetId ?? null}
      />
      <InterrogationView
        scene={gameState.value.scene}
        inventory={gameState.value.inventory}
        onAnswerQuestion={answerInterrogationQuestion}
        onPressStatement={pressTestimonyStatement}
        onPresentItem={presentTestimonyItem}
        disabled={gameState.inFlight}
      />
    {:else if gameState.value.mode.type === "gameComplete"}
      <GameComplete onReset={handleReset} disabled={gameState.inFlight} />
    {/if}
  </GameShell>
{:else if gameState.loading}
  <main><p class="status">載入中...</p></main>
{:else}
  <MainMenu
    onNewGame={startGame}
    onExit={handleExit}
    disabled={gameState.inFlight}
  />
  {#if gameState.error}
    <div class="menu-error">
      <ErrorBanner message={gameState.error} />
    </div>
  {/if}
{/if}

<style>
  .status {
    padding: 32px;
    color: var(--bone-dim);
  }
  .menu-error {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    z-index: 100;
    padding: 16px;
  }
</style>
