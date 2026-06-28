<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { Snippet } from "svelte";
  import {
    audioPreferences,
    updateAudioPreferences,
  } from "$lib/audio/gameplay-audio-runtime.svelte";
  import type { GameStateView } from "../state/types";
  import { closeTopmostEscapeClaim } from "$lib/state/escape-coordinator";
  import AudioSettings from "./AudioSettings.svelte";
  import GameAtmosphere from "./GameAtmosphere.svelte";

  let {
    gameState,
    onReset,
    disabled = false,
    children,
    menu,
  }: {
    gameState: GameStateView;
    onReset: () => void;
    disabled?: boolean;
    children: Snippet;
    menu?: Snippet;
  } = $props();

  let showChapterHud = $derived(gameState.mode.type !== "explore");
  let gameMenuOpen = $state(false);
  let resumeButton: HTMLButtonElement | undefined = $state();
  let gameMenuPanel: HTMLDivElement | undefined = $state();
  let previouslyFocusedElement: HTMLElement | null = null;

  const focusableSelector = [
    "button:not(:disabled)",
    "[href]",
    "input:not(:disabled)",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  async function reassertFullscreenIfActive() {
    // Distinguish "no Tauri runtime" (silent) from real IPC failures
    // (logged). In browser/preview/test environments the Tauri module may
    // be absent (import fails) OR present but uninitialized
    // (`getCurrentWindow()` throws because the runtime bridge is missing) —
    // both are the expected no-runtime case and must stay silent. In
    // production Tauri the import and `getCurrentWindow()` always succeed,
    // so a failure in `isFullscreen()`/`setFullscreen()` is a real error
    // (permission revoked, window race) and must leave a diagnostic —
    // otherwise the menu opens but fullscreen reassertion silently no-ops
    // and the regression is invisible.
    let windowApi;
    try {
      windowApi = await import("@tauri-apps/api/window");
    } catch {
      return;
    }
    let currentWindow;
    try {
      currentWindow = windowApi.getCurrentWindow();
    } catch {
      return;
    }
    try {
      const wasFullscreen = await currentWindow.isFullscreen();
      if (wasFullscreen === true) {
        await currentWindow.setFullscreen(true);
      }
    } catch (error) {
      console.warn("[GameShell] fullscreen reassert failed:", error);
    }
  }

  async function openGameMenu() {
    if (!gameMenuOpen) {
      const activeElement = document.activeElement;
      previouslyFocusedElement =
        activeElement instanceof HTMLElement ? activeElement : null;
      gameMenuOpen = true;
      await tick();
      resumeButton?.focus();
    }
  }

  function closeGameMenu() {
    if (!gameMenuOpen) {
      return;
    }

    gameMenuOpen = false;
    const elementToRestore = previouslyFocusedElement;
    previouslyFocusedElement = null;

    void tick().then(() => {
      if (elementToRestore?.isConnected) {
        elementToRestore.focus();
      }
    });
  }

  function handleMenuReset() {
    closeGameMenu();
    onReset();
  }

  function handleGameMenuKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || !gameMenuPanel) {
      return;
    }

    const focusableElements = Array.from(
      gameMenuPanel.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    if (focusableElements.length === 0) {
      event.preventDefault();
      gameMenuPanel.focus();
      return;
    }

    const firstElement = focusableElements[0];
    const lastElement = focusableElements.at(-1);

    if (event.shiftKey && document.activeElement === firstElement) {
      event.preventDefault();
      lastElement?.focus();
      return;
    }

    if (!event.shiftKey && document.activeElement === lastElement) {
      event.preventDefault();
      firstElement.focus();
    }
  }

  onMount(() => {
    // Global capture-phase Escape listener — the sole entry point for Escape.
    // capture:true + stopImmediatePropagation ensures Escape never reaches
    // dialogue/investigation controls behind the overlay, so they can't
    // intercept it before the menu toggles.
    //
    // Coexistence note: DialogueBox also registers a window keydown, but only
    // for Space/Enter (not Escape). capture + stopImmediatePropagation keeps
    // the contract one-directional — Escape is owned here, advance keys stay
    // owned by DialogueBox.
    //
    // Priority: the menu is always closed first (it is the topmost layer).
    // Then, if a nested overlay (e.g. the investigation topic popover) has
    // claimed Escape via the escape-coordinator, one Escape closes that
    // overlay instead of opening the menu — "close one layer per Escape."
    // Only when no overlay claims Escape does the menu open. Overlays claim
    // Escape through $lib/state/escape-coordinator; see InvestigationSceneSurface
    // for the popover usage.
    const handleKeydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation();

      if (gameMenuOpen) {
        closeGameMenu();
        return;
      }

      if (closeTopmostEscapeClaim()) {
        return;
      }

      void reassertFullscreenIfActive();
      void openGameMenu();
    };

    window.addEventListener("keydown", handleKeydown, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleKeydown, { capture: true });
    };
  });
</script>

<div class="shell">
  <GameAtmosphere intensity={0.55} />

  {#if showChapterHud}
    <header inert={gameMenuOpen}>
      <div class="left">
        <span class="case-marker">
          <span class="diamond"></span>
          FILE&nbsp;{String(gameState.chapter.index + 1).padStart(
            2,
            "0",
          )}&nbsp;/&nbsp;{String(gameState.chapter.total).padStart(2, "0")}
        </span>
        <div class="title-row">
          <p class="eyebrow">
            第&nbsp;{gameState.chapter.index + 1}&nbsp;章&nbsp;·&nbsp;CHAPTER
          </p>
          <h1>{gameState.chapter.title}</h1>
        </div>
        <p class="summary">{gameState.chapter.summary}</p>
      </div>
    </header>

    <div class="rule"></div>
  {/if}

  <main inert={gameMenuOpen}>
    {@render children()}
  </main>

  {#if gameMenuOpen}
    <div
      class="game-menu-scrim"
      role="dialog"
      aria-modal="true"
      aria-labelledby="game-menu-title"
      tabindex="-1"
      onclick={(event) => {
        // Backdrop-dismiss: only close when the click lands on the scrim
        // itself (currentTarget), not when it bubbles up from inside the
        // panel. This replaces the panel-level stopPropagation so the panel
        // needs no click handler (and thus no ARIA role/keyboard handler
        // pairing that svelte-check would otherwise flag).
        if (event.target === event.currentTarget) {
          closeGameMenu();
        }
      }}
      onkeydown={handleGameMenuKeydown}
    >
      <div class="game-menu-panel" bind:this={gameMenuPanel} tabindex="-1">
        <div class="game-menu-heading">
          <span class="case-marker">
            <span class="diamond"></span>
            CASE&nbsp;MENU
          </span>
          <h2 id="game-menu-title">遊戲選單</h2>
          <p>
            FILE&nbsp;{String(gameState.chapter.index + 1).padStart(2, "0")}
          </p>
        </div>

        <div class="game-menu-actions">
          <button
            bind:this={resumeButton}
            type="button"
            class="primary"
            onclick={closeGameMenu}
          >
            <span>繼續調查</span>
            <span class="en">RESUME</span>
          </button>
          <button type="button" onclick={handleMenuReset} {disabled}>
            <span>結束案件</span>
            <span class="en">CLOSE&nbsp;CASE</span>
          </button>
        </div>

        {#if menu}
          <div class="game-menu-extra">
            {@render menu()}
          </div>
        {/if}

        <AudioSettings
          preferences={audioPreferences}
          onUpdate={updateAudioPreferences}
        />
      </div>
    </div>
  {/if}
</div>

<style>
  .shell {
    position: relative;
    min-height: 100vh;
    color: var(--bone);
    isolation: isolate;
  }

  header {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 32px;
    padding: 22px clamp(20px, 3vw, 40px) 18px;
  }

  .left {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 1 1 360px;
    max-width: 720px;
    min-width: 0;
  }

  .case-marker {
    align-self: flex-start;
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.32em;
    color: var(--bone);
    padding: 6px 11px 5px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    text-transform: uppercase;
  }

  .case-marker .diamond {
    width: 5px;
    height: 5px;
    background: var(--crimson);
    transform: rotate(45deg);
    box-shadow: 0 0 7px var(--crimson);
  }

  .title-row {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .eyebrow {
    margin: 0;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 11px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: clamp(22px, 2.4vw, 30px);
    line-height: 1.05;
    letter-spacing: 0.06em;
    color: var(--bone);
    text-shadow: 2px 2px 0 var(--cell);
  }

  .summary {
    margin: 4px 0 0;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.55;
    max-width: 56ch;
  }

  .rule {
    position: relative;
    z-index: 2;
    height: 1px;
    margin: 0 clamp(20px, 3vw, 40px);
    background: linear-gradient(
      90deg,
      transparent,
      var(--rule-strong) 12%,
      var(--rule-strong) 88%,
      transparent
    );
  }

  main {
    position: relative;
    z-index: 2;
  }

  .game-menu-scrim {
    position: fixed;
    inset: 0;
    z-index: 40;
    display: grid;
    place-items: center;
    padding: 24px;
    background:
      linear-gradient(rgba(6, 6, 10, 0.76), rgba(6, 6, 10, 0.82)),
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 4px,
        rgba(0, 0, 0, 0.24) 5px
      );
    backdrop-filter: blur(5px);
  }

  .game-menu-panel {
    display: flex;
    flex-direction: column;
    gap: 22px;
    width: min(420px, 100%);
    padding: 24px;
    border: 1px solid var(--rule-strong);
    background: rgba(8, 8, 14, 0.94);
    box-shadow:
      0 20px 70px rgba(0, 0, 0, 0.48),
      inset 0 0 0 1px rgba(236, 228, 207, 0.05);
  }

  .game-menu-heading {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .game-menu-heading h2,
  .game-menu-heading p {
    margin: 0;
  }

  .game-menu-heading h2 {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 28px;
    line-height: 1;
    letter-spacing: 0.08em;
    color: var(--bone);
  }

  .game-menu-heading p {
    font-family: var(--impact);
    font-size: 11px;
    letter-spacing: 0.28em;
    color: var(--cyan);
  }

  .game-menu-actions {
    display: grid;
    gap: 10px;
  }

  .game-menu-actions button {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    width: 100%;
    min-height: 52px;
    padding: 12px 14px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 15px;
    letter-spacing: 0.08em;
    cursor: pointer;
    transition:
      background 0.18s,
      border-color 0.18s,
      color 0.18s;
  }

  .game-menu-actions button.primary,
  .game-menu-actions button:hover:not(:disabled),
  .game-menu-actions button:focus-visible {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
  }

  .game-menu-actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .game-menu-actions .en {
    flex: 0 0 auto;
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
    color: var(--bone-faint);
  }

  .game-menu-extra {
    min-width: 0;
  }

  @media (max-width: 720px) {
    /* lyra-mobile-breakpoint — see tokens.css; keep in sync with the other
       three 720px compaction sites. */
    .game-menu-scrim {
      padding: 18px;
      align-items: end;
    }

    .game-menu-panel {
      padding: 20px;
    }
  }
</style>
