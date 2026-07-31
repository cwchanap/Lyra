<script lang="ts">
  import GameShell from "$lib/components/GameShell.svelte";
  import type { GameStateView } from "$lib/state/types";

  let {
    gameState,
    onCloseCase,
    onSaveGame,
    onLoadGame,
    onReturnToTitle,
    onTopLayerEscape,
    disabled = false,
    open = $bindable(false),
    topLayerOpen = false,
    gameplayInert = false,
    menuContent = null,
    menuExtraButtonLabel = null,
    sceneMenuEnabled = false,
    caseFileMenuEnabled = true,
    sceneMenuContent = null,
    menuInitialFocusLabel = null,
  }: {
    gameState: GameStateView;
    onCloseCase: () => void;
    onSaveGame?: () => void;
    onLoadGame?: () => void;
    onReturnToTitle?: () => void;
    onTopLayerEscape?: () => void;
    disabled?: boolean;
    // Forwarded as a bindable so tests can drive the external close path
    // (production: +page.svelte closes the menu on dossier reexamine).
    open?: boolean;
    topLayerOpen?: boolean;
    gameplayInert?: boolean;
    menuContent?: string | null;
    // When set, renders a focusable <button> inside the menu slot. Mirrors
    // production's CaseFilePanel, whose record controls are
    // focusable controls the focus trap must include in its Tab cycle. The
    // default <p> slot content is non-focusable, so without this knob the
    // focus-trap test never exercises a focusable slot element.
    menuExtraButtonLabel?: string | null;
    sceneMenuEnabled?: boolean;
    caseFileMenuEnabled?: boolean;
    sceneMenuContent?: string | null;
    menuInitialFocusLabel?: string | null;
  } = $props();
</script>

<GameShell
  {gameState}
  {onCloseCase}
  {onSaveGame}
  {onLoadGame}
  {onReturnToTitle}
  {onTopLayerEscape}
  {disabled}
  {topLayerOpen}
  {gameplayInert}
  {sceneMenuEnabled}
  {caseFileMenuEnabled}
  bind:open
>
  {#snippet sceneMenu()}
    {#if sceneMenuContent}
      <button type="button" class="harness-scene-menu-button">
        {sceneMenuContent}
      </button>
    {/if}
  {/snippet}

  {#snippet menu()}
    {#if menuContent}
      <p>{menuContent}</p>
    {/if}
    {#if menuExtraButtonLabel}
      <button type="button" class="harness-extra-menu-button">
        {menuExtraButtonLabel}
      </button>
    {/if}
    {#if menuInitialFocusLabel}
      <button type="button" data-submenu-initial-focus>
        {menuInitialFocusLabel}
      </button>
    {/if}
  {/snippet}

  <p class="shell-content">scoped child</p>
</GameShell>
