<script lang="ts">
  import GameShell from "./GameShell.svelte";
  import type { GameStateView } from "$lib/state/types";

  let {
    gameState,
    onReset,
    disabled = false,
    open = $bindable(false),
    menuContent = null,
    menuExtraButtonLabel = null,
    sceneMenuEnabled = false,
    sceneMenuContent = null,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    disabled?: boolean;
    // Forwarded as a bindable so tests can drive the external close path
    // (production: +page.svelte closes the menu on dossier reexamine).
    open?: boolean;
    menuContent?: string | null;
    // When set, renders a focusable <button> inside the menu slot. Mirrors
    // production's <InventoryPanel>, whose toggle/evidence buttons are
    // focusable controls the focus trap must include in its Tab cycle. The
    // default <p> slot content is non-focusable, so without this knob the
    // focus-trap test never exercises a focusable slot element.
    menuExtraButtonLabel?: string | null;
    sceneMenuEnabled?: boolean;
    sceneMenuContent?: string | null;
  } = $props();
</script>

<GameShell
  {gameState}
  onCloseCase={onReset}
  {disabled}
  {sceneMenuEnabled}
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
  {/snippet}

  <p class="shell-content">scoped child</p>
</GameShell>
