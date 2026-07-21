<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { DialogueHistoryEntry } from "../state/types";

  let {
    history,
    onClose,
    bottom = 180,
  }: {
    history: DialogueHistoryEntry[];
    onClose: () => void;
    bottom?: number;
  } = $props();

  let panel: HTMLDivElement | undefined = $state();
  let closeButton: HTMLButtonElement | undefined = $state();

  const focusableSelector = [
    "button:not(:disabled)",
    "[href]",
    "input:not(:disabled)",
    "select:not(:disabled)",
    "textarea:not(:disabled)",
    '[tabindex]:not([tabindex="-1"])',
  ].join(",");

  // Hand focus to the CLOSE button on mount so keyboard users who open
  // history via the LOG button (which renders after this panel in DOM and
  // whose sibling advance controls go inert while history is open) can
  // still reach the panel's Tab cycle. The post-L-close focus concern is
  // handled separately in DialogueBox by focusing the advance button on
  // closeHistory({ refocusLog: false }), so this open-path handoff is safe.
  onMount(() => {
    void tick().then(() => closeButton?.focus());
  });

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || !panel) return;

    const focusableElements = Array.from(
      panel.querySelectorAll<HTMLElement>(focusableSelector),
    ).filter((element) => {
      const style = getComputedStyle(element);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    if (focusableElements.length === 0) {
      event.preventDefault();
      panel.focus();
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
</script>

<!-- aria-modal="false" is intentional even though the gameplay behind this
     panel is dimmed (.history-backdrop in DialogueBox). The backdrop is
     purely visual with pointer-events: none so the LOG button stays
     mouse-clickable while history is open (LOG toggles the panel closed).
     aria-modal="true" would instruct ATs to hide background content, but
     the LOG button must remain operable, so we mark the panel non-modal and
     rely on the dimmed backdrop + inert dialogue surface for sighted users. -->
<div
  bind:this={panel}
  class="history-panel"
  role="dialog"
  aria-modal="false"
  aria-labelledby="dialogue-history-title"
  tabindex="-1"
  onkeydown={handleKeydown}
  style="--history-panel-bottom: {bottom}px"
>
  <header>
    <div>
      <p class="eyebrow">LOG</p>
      <h2 id="dialogue-history-title">對話紀錄</h2>
    </div>
    <button
      bind:this={closeButton}
      class="close-button"
      type="button"
      aria-label="關閉對話紀錄"
      aria-describedby="dialogue-history-close-hint"
      onclick={onClose}
    >
      CLOSE
    </button>
  </header>

  {#if history.length === 0}
    <p class="empty">尚無對話紀錄</p>
  {:else}
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <ol class="history-list" tabindex="0" aria-label="對話紀錄列表" role="list">
      {#each history as entry (entry.id)}
        <li>
          {#if entry.kind === "line"}
            <p class="speaker">{entry.speaker}</p>
            <p class="text">{entry.text}</p>
          {:else}
            <p class="speaker narration">敘述</p>
            <p class="text">{entry.text}</p>
          {/if}
        </li>
      {/each}
    </ol>
  {/if}

  <!-- Discovered via the CLOSE button's aria-describedby so AT users learn the
       L shortcut also closes the popup. Visually hidden; not focusable. -->
  <span id="dialogue-history-close-hint" class="sr-only">按 L 關閉</span>
</div>

<style>
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
    border: 0;
  }

  .history-panel {
    position: fixed;
    left: 50%;
    /* `bottom` is passed in from DialogueBox, which measures the dialogue
       wrapper's actual height and positions this panel above the wrapper's
       top edge with a 12px gap. This keeps the LOG button mouse-clickable
       even when the dialogue box grows past its 160px min-height (long
       wrapping action/testimony lines). The default 180px is a fallback;
       DialogueBox overrides it on open. The height formula references the
       same custom property so the panel shrinks as `bottom` grows — keeping
       a 24px top margin and the header/CLOSE control within the viewport on
       the 800×600 Tauri window instead of letting the top slip off-screen
       when the wrapper grows past its min-height. `box-sizing: border-box`
       makes `height` the border-box height so the padding+border are
       accounted for by the formula (no content-box overflow).
       Clamp both values so a very tall wrapper (long wrapped action or
       testimony pushing `--history-panel-bottom` past the viewport) cannot
       collapse the panel: `bottom` is capped at `calc(100dvh - 184px)` so
       the panel never slips fully off the top (184px = 160px min panel
       height + 24px top margin), and `height` is floored at 160px so the
       header + CLOSE control + a few history rows stay visible inside the
       `overflow: hidden` panel. In the degenerate case the panel overlaps
       the upper portion of the dialogue wrapper, which is acceptable — the
       panel sits at z-index 35 above the wrapper (z-index 30) and the
       backdrop dims the wrapper behind it. */
    box-sizing: border-box;
    bottom: min(var(--history-panel-bottom, 180px), calc(100dvh - 184px));
    z-index: 35;
    width: min(900px, calc(100vw - 56px));
    height: max(
      160px,
      min(460px, calc(100dvh - var(--history-panel-bottom, 180px) - 24px))
    );
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 18px;
    padding: 20px;
    overflow: hidden;
    transform: translateX(-50%);
    border: 1px solid var(--rule-strong);
    background: rgba(8, 8, 14, 0.99);
    color: var(--bone);
    box-shadow: 0 22px 70px rgba(0, 0, 0, 0.52);
  }

  header {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }

  h2,
  p {
    margin: 0;
  }

  h2 {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 24px;
    line-height: 1;
    letter-spacing: 0.06em;
  }

  .eyebrow,
  .close-button {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.24em;
    color: var(--crimson);
  }

  .close-button {
    min-height: 34px;
    padding: 8px 10px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    cursor: pointer;
  }

  .close-button:hover,
  .close-button:focus-visible {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .history-list {
    min-height: 0;
    margin: 0;
    padding: 0;
    overflow-y: auto;
    list-style: none;
    display: grid;
    align-content: end;
    gap: 12px;
  }

  .history-list:focus-visible {
    outline: 1px solid var(--crimson);
    outline-offset: 2px;
  }

  li {
    display: grid;
    gap: 4px;
    padding: 12px 0;
    border-top: 1px solid rgba(236, 228, 207, 0.12);
  }

  .speaker {
    font-family: var(--impact);
    font-size: 11px;
    letter-spacing: 0.18em;
    overflow-wrap: anywhere;
    color: var(--cyan);
  }

  .speaker.narration {
    color: var(--bone-faint);
  }

  .text,
  .empty {
    font-family: var(--serif-jp);
    font-size: 15px;
    line-height: 1.65;
    overflow-wrap: anywhere;
    color: var(--bone);
  }

  .empty {
    color: var(--bone-dim);
  }

  @media (max-width: 720px) {
    .history-panel {
      width: min(900px, calc(100vw - 36px));
      height: max(
        160px,
        min(440px, calc(100dvh - var(--history-panel-bottom, 180px) - 24px))
      );
      padding: 18px;
    }
  }
</style>
