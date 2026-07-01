<script lang="ts">
  import { onMount, tick } from "svelte";
  import type { DialogueHistoryEntry } from "../state/types";

  let {
    history,
    onClose,
  }: {
    history: DialogueHistoryEntry[];
    onClose: () => void;
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

<div
  bind:this={panel}
  class="history-panel"
  role="dialog"
  aria-modal="false"
  aria-labelledby="dialogue-history-title"
  tabindex="-1"
  onkeydown={handleKeydown}
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
      onclick={onClose}
    >
      CLOSE
    </button>
  </header>

  {#if history.length === 0}
    <p class="empty">尚無對話紀錄</p>
  {:else}
    <ol class="history-list">
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
</div>

<style>
  .history-panel {
    position: fixed;
    left: 50%;
    bottom: 170px;
    z-index: 35;
    width: min(900px, calc(100vw - 56px));
    max-height: min(460px, calc(100dvh - 220px));
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 18px;
    padding: 20px;
    overflow: hidden;
    transform: translateX(-50%);
    border: 1px solid var(--rule-strong);
    background: rgba(8, 8, 14, 0.96);
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
    color: var(--bone);
  }

  .empty {
    color: var(--bone-dim);
  }

  @media (max-width: 720px) {
    .history-panel {
      bottom: 150px;
      width: min(900px, calc(100vw - 36px));
      max-height: min(440px, calc(100dvh - 190px));
      padding: 18px;
    }
  }
</style>
