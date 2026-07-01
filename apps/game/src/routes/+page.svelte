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
  import { untrack } from "svelte";

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
  let sceneNavigationError = $state(false);
  // Monotonic generation counter for scene-nav loads. Captured at the start
  // of each loadSceneNavigationIndex call and checked after the await: if a
  // close-case / retry bumped the gen while this load was in flight, the
  // result is stale and must NOT touch the latches — otherwise a late
  // failure from a closed session could re-set sceneNavigationError after
  // handleCloseCase already cleared it, and the title-screen reset effect
  // (which only reruns on gameState.value changes) wouldn't fire again to
  // clear it, leaving the next session's Scene Select stuck.
  let sceneNavigationLoadGen = $state(0);
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
    // Returning to the title clears any stale scene-nav failure latch so a
    // fresh game session re-attempts the index load instead of inheriting the
    // previous session's error. The cached index (if any) is kept — scene
    // data is static across sessions, so a successful prior load need not be
    // re-fetched.
    if (gameState.value === null) {
      sceneNavigationError = false;
      sceneNavigationRequested = false;
    }
  });

  $effect(() => {
    if (
      sceneNavigationEnabled &&
      gameState.value &&
      !sceneNavigationIndex &&
      !sceneNavigationLoading &&
      !sceneNavigationRequested &&
      !sceneNavigationError
    ) {
      // Set the latch synchronously before any async work so a rapid second
      // $effect run (e.g. gameState.value changing) can't re-trigger the load.
      sceneNavigationRequested = true;
      void loadSceneNavigationIndex();
    }
  });

  async function loadSceneNavigationIndex() {
    // untrack: this function is called synchronously from the auto-load
    // $effect. Reading sceneNavigationLoadGen here without untrack would
    // register it as an effect dependency, and since handleCloseCase /
    // retrySceneNavigation bump the gen, the auto-load effect would re-fire
    // on every bump — an update loop. The gen is only used as a stale-load
    // guard, not as a reactive input.
    const gen = untrack(() => sceneNavigationLoadGen);
    sceneNavigationLoading = true;
    const index = await listScenes();
    // If a close-case / retry bumped the gen while this load was in
    // flight, drop the result — the superseding path owns the latches now.
    // Applying a stale failure here would re-set sceneNavigationError
    // after the reset already cleared it.
    if (gen !== sceneNavigationLoadGen) return;
    if (index) {
      sceneNavigationIndex = index;
      sceneNavigationError = false;
    } else {
      // listScenes returns null on failure and owns its own error surface
      // (it does NOT populate gameState.error). Do NOT clear
      // sceneNavigationRequested and let the $effect auto-retry — that would
      // loop on a persistent failure. Instead surface the failure via the
      // panel's own error state and let the user explicitly retry.
      sceneNavigationError = true;
    }
    sceneNavigationLoading = false;
  }

  function retrySceneNavigation() {
    // Drive the load directly rather than relying on the auto-load $effect.
    // Setting only the error/requested latches and letting the $effect re-fire
    // would render one frame with error=false, loading=false, index=null —
    // landing in the "no scenes" empty state before loading flips true.
    // loadSceneNavigationIndex sets loading=true synchronously as its first
    // statement, so calling it here avoids that flicker.
    sceneNavigationError = false;
    sceneNavigationRequested = true;
    // Supersede any in-flight load so its stale result doesn't clobber the
    // retry's outcome.
    sceneNavigationLoadGen += 1;
    void loadSceneNavigationIndex();
  }

  async function handleReset() {
    await resetGame();
    if (gameState.error) {
      return;
    }
    gameState.error = null;
  }

  function handleCloseCase() {
    // Reset the scene-nav latches synchronously so a failed index load in
    // this session does not suppress the auto-load in the next. (The
    // return-to-title $effect is a defensive backstop for any other path
    // that nulls gameState.value; this is the deterministic primary reset.)
    sceneNavigationError = false;
    sceneNavigationRequested = false;
    sceneNavigationLoading = false;
    // Invalidate any in-flight load so a late failure from this session
    // cannot re-set the error latch after the reset.
    sceneNavigationLoadGen += 1;
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
    evidenceMenuEnabled={shouldShowInventoryPanel(gameState.value.mode)}
    onOpenEvidence={() => {
      inventoryPanelOpen = true;
    }}
    bind:open={gameMenuOpen}
  >
    {#snippet sceneMenu()}
      <SceneNavigationPanel
        index={sceneNavigationIndex}
        current={gameState.value!}
        loading={sceneNavigationLoading}
        error={sceneNavigationError}
        disabled={gameState.inFlight}
        onSelect={handleJumpToScene}
        onRetry={retrySceneNavigation}
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
        history={gameState.value.dialogueHistory}
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
