<script lang="ts">
  import { tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import DialogueHistoryPanel from "./DialogueHistoryPanel.svelte";
  import type {
    DialogueHistoryEntry,
    DialogueItem,
    QueueToken,
  } from "../state/types";

  let {
    current,
    queueToken,
    onAdvance,
    onAdvanceFeedback,
    history = [],
    disabled = false,
  }: {
    current: DialogueItem;
    queueToken: QueueToken;
    onAdvance: (t: QueueToken) => void;
    onAdvanceFeedback?: () => void;
    history?: DialogueHistoryEntry[];
    disabled?: boolean;
  } = $props();

  const rightSidePortraitCharacterIds = new Set([
    "clerk",
    "hayasaka_akane",
    "miyake_mother",
    "miyake_sota",
    "soma_ritsu",
    "takase_manager",
  ]);

  let portraitAsset = $state<ResolvedStoryAsset | null>(null);
  let historyOpen = $state(false);
  let logButton: HTMLButtonElement | undefined = $state();
  const portraitAssetId = $derived(
    current.kind === "line" ? (current.portrait?.assetId ?? null) : null,
  );
  const portraitPlacement = $derived(
    current.kind === "line"
      ? placementForPortrait(current.portrait?.characterId)
      : "left",
  );

  function placementForPortrait(characterId: string | null | undefined) {
    return rightSidePortraitCharacterIds.has(characterId ?? "")
      ? "right"
      : "left";
  }

  $effect(() => {
    let cancelled = false;
    portraitAsset = null;
    resolveStoryAsset(portraitAssetId, "portrait").then((asset) => {
      if (!cancelled) portraitAsset = asset;
    });
    return () => {
      cancelled = true;
    };
  });

  function handlePortraitError() {
    if (!portraitAsset || portraitAsset.placeholder) return;
    console.warn(
      `[DialogueBox] Missing portrait asset: ${portraitAsset.url} (assetId: ${portraitAsset.assetId})`,
    );
    portraitAsset = placeholderForMissingStoryAsset(
      portraitAsset.assetId,
      "portrait",
    );
  }

  function dispatchAdvance() {
    onAdvanceFeedback?.();
    if (disabled) return;
    onAdvance(queueToken);
  }

  function handleClick() {
    if (historyOpen) return;
    dispatchAdvance();
  }

  function handleBoxKeydown(e: KeyboardEvent) {
    if (e.target !== e.currentTarget) return;
    if (e.repeat) return;
    if (e.key !== " " && e.key !== "Enter") return;
    e.preventDefault();
    e.stopPropagation();
    if (historyOpen) return;
    dispatchAdvance();
  }

  function openHistory() {
    historyOpen = true;
  }

  async function closeHistory() {
    if (!historyOpen) return;
    historyOpen = false;
    await tick();
    logButton?.focus();
  }

  function toggleHistory() {
    if (historyOpen) {
      void closeHistory();
      return;
    }
    openHistory();
  }

  const interactiveFocusSelector = [
    "button",
    "a[href]",
    "input",
    "select",
    "textarea",
    '[role="button"]',
    '[tabindex]:not([tabindex="-1"])',
    '[contenteditable="true"]',
  ].join(",");

  function isShortcutBlockedByFocusedControl() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      return false;
    }
    if (active === logButton || active.closest(".box")) {
      return false;
    }
    return Boolean(active.closest(interactiveFocusSelector));
  }

  $effect(() => {
    if (!historyOpen) return;
    const release = claimEscape(closeHistory);
    return () => {
      release();
    };
  });

  function handleKey(e: KeyboardEvent) {
    if (e.repeat) return;

    if (e.key === "l" || e.key === "L") {
      if (isShortcutBlockedByFocusedControl()) return;
      e.preventDefault();
      toggleHistory();
      return;
    }

    if (e.key !== " " && e.key !== "Enter") return;
    if (historyOpen) {
      e.preventDefault();
      return;
    }
    const active = document.activeElement;
    if (active && active !== document.body) return;
    e.preventDefault();
    dispatchAdvance();
  }
</script>

<!--
  This window-level keydown handler advances dialogue on Space/Enter ONLY.
  Escape is deliberately NOT handled here: it is reserved by GameShell's
  capture-phase handler as the sole entry point for opening the game menu,
  which calls stopImmediatePropagation() so Escape never reaches this handler
  while the menu is open. Do NOT add Escape handling here — it would race the
  menu toggle and reintroduce the conflict. See GameShell.svelte onMount.
-->
<svelte:window onkeydown={handleKey} />

{#if current.kind === "line" && portraitAsset}
  <img
    class="portrait"
    src={portraitAsset.url}
    alt=""
    aria-hidden="true"
    onerror={handlePortraitError}
    data-placement={portraitPlacement}
    data-layer="behind-dialogue"
    class:left={portraitPlacement === "left"}
    class:right={portraitPlacement === "right"}
    style="--portrait-height: min(1536px, 80vh);"
  />
{/if}

{#if historyOpen}
  <DialogueHistoryPanel {history} onClose={closeHistory} />
{/if}

<div class="wrapper" class:line={current.kind === "line"} inert={historyOpen}>
  <button
    bind:this={logButton}
    class="log-button"
    type="button"
    aria-label="開啟對話紀錄"
    aria-pressed={historyOpen}
    onclick={(event) => {
      event.stopPropagation();
      toggleHistory();
    }}
  >
    LOG
  </button>

  <div
    class="box"
    class:scene={current.kind === "sceneTag"}
    class:action={current.kind === "action"}
    class:line={current.kind === "line"}
    role="button"
    tabindex="0"
    onclick={handleClick}
    onkeydown={handleBoxKeydown}
    aria-label="推進對話"
    aria-disabled={disabled}
  >
    {#if current.kind === "sceneTag"}
      <span class="kind">場 · SCENE</span>
      <p class="text-scene">（場景切換）</p>
    {:else if current.kind === "action"}
      <span class="kind">敘述 · NARRATION</span>
      <p class="text-action">{current.text}</p>
    {:else if current.kind === "line"}
      <div class="line-grid">
        <div class="speaker-block">
          <span class="kind">發言 · LINE</span>
          <span class="speaker">{current.speaker}</span>
        </div>
        <p class="text-line">{current.text}</p>
      </div>
    {/if}

    <div class="hint">
      <span class="key">Space</span>
      <span class="arrow">▶</span>
    </div>
  </div>
</div>

<style>
  .wrapper {
    --dialogue-width: min(960px, calc(100vw - 56px));
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    width: var(--dialogue-width);
    z-index: 30;
  }

  .box {
    width: 100%;
    box-sizing: border-box;
    padding: 22px 104px 24px 28px;
    background: rgba(20, 20, 31, 0.94);
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--crimson);
    clip-path: polygon(
      0 0,
      calc(100% - 22px) 0,
      100% 22px,
      100% 100%,
      22px 100%,
      0 calc(100% - 22px)
    );
    text-align: left;
    cursor: pointer;
    font: inherit;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.55);
    transition:
      border-color 0.2s,
      background 0.2s;
  }

  .box:hover:not([aria-disabled="true"]),
  .box:focus-visible {
    border-color: var(--crimson);
    background: rgba(29, 29, 43, 0.96);
    outline: none;
  }

  .box[aria-disabled="true"] {
    cursor: wait;
    opacity: 0.7;
  }

  .log-button {
    position: absolute;
    top: 14px;
    right: 18px;
    z-index: 1;
    min-width: 52px;
    min-height: 32px;
    padding: 7px 10px 6px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    cursor: pointer;
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
  }

  .log-button:hover,
  .log-button:focus-visible,
  .log-button[aria-pressed="true"] {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: none;
  }

  .portrait {
    position: fixed;
    bottom: 0;
    width: auto;
    height: var(--portrait-height);
    max-width: none;
    object-fit: contain;
    pointer-events: none;
    filter: drop-shadow(0 18px 30px rgba(0, 0, 0, 0.58));
    z-index: 20;
  }

  .portrait.left {
    left: 0;
    transform: none;
  }

  .portrait.right {
    right: 0;
    transform: none;
  }

  .kind {
    display: inline-block;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--crimson);
    text-transform: uppercase;
    margin-bottom: 6px;
  }

  .speaker {
    display: block;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 18px;
    letter-spacing: 0.1em;
    color: var(--bone);
    line-height: 1.1;
  }

  .speaker-block {
    flex: 0 0 auto;
    min-width: 140px;
    padding-right: 22px;
    border-right: 1px solid var(--rule-strong);
  }

  .line-grid {
    display: flex;
    gap: 24px;
    align-items: flex-start;
  }

  .text-line {
    margin: 4px 0 0;
    font-family: var(--serif-jp);
    font-size: 16px;
    line-height: 1.75;
    color: var(--bone);
    letter-spacing: 0.04em;
    flex: 1 1 auto;
  }

  .text-action {
    margin: 0;
    font-family: var(--serif-it);
    font-style: italic;
    color: var(--bone-dim);
    text-align: center;
    font-size: 17px;
    line-height: 1.6;
    letter-spacing: 0.02em;
  }

  .text-scene {
    margin: 0;
    font-family: var(--serif-jp);
    color: var(--bone-faint);
    font-style: italic;
    text-align: center;
    font-size: 14px;
  }

  .box.action,
  .box.scene {
    border-left-color: var(--rule-strong);
  }

  .hint {
    position: absolute;
    right: 22px;
    bottom: 10px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }

  .hint .key {
    padding: 2px 6px 1px;
    border: 1px solid var(--rule-strong);
  }

  .hint .arrow {
    color: var(--crimson);
    animation: lyra-pulse 1.6s ease-in-out infinite;
  }
</style>
