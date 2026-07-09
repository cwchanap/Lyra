<script lang="ts">
  import { tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import CrossfadeImage from "./CrossfadeImage.svelte";
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
    crossExam = null,
  }: {
    current: DialogueItem;
    queueToken: QueueToken;
    onAdvance: (t: QueueToken) => void;
    onAdvanceFeedback?: () => void;
    history?: DialogueHistoryEntry[];
    disabled?: boolean;
    /** Present while an interrogation testimony plays here: renders the inline
     * 反駁 / 退下 controls that act on the currently-shown line. */
    crossExam?: {
      lineId: string;
      onChallenge: (lineId: string) => void;
      onWithdraw: () => void;
    } | null;
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

  // The inline cross-exam buttons live inside the click-to-advance box, so
  // each must stop propagation or the click would also advance the testimony.
  function handleChallengeClick(e: MouseEvent) {
    e.stopPropagation();
    if (disabled || !crossExam) return;
    crossExam.onChallenge(crossExam.lineId);
  }

  function handleWithdrawClick(e: MouseEvent) {
    e.stopPropagation();
    if (disabled || !crossExam) return;
    crossExam.onWithdraw();
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

  // The LOG button is a native <button>, so Space/Enter activation is delivered
  // as a synthesized click (with detail 0). AT click activation (e.g. VoiceOver
  // VO+Space, programmatic .click()) also produces detail 0. Treat the click
  // handler as the single activation path so all of these reach toggleHistory;
  // do NOT gate on e.detail === 0, which would drop AT activation. The
  // window-level handleKey returns early when the LOG button is focused, so
  // Space/Enter never advances dialogue from here.
  function handleLogButtonClick(e: MouseEvent) {
    e.stopPropagation();
    toggleHistory();
  }

  function openHistory() {
    historyOpen = true;
  }

  // Held while history is open so closeHistory can release the escape claim
  // synchronously rather than waiting for the $effect cleanup flush. The
  // $effect below still claims/releases for unmount safety; release() is
  // idempotent so the double-release on close is harmless.
  let releaseEscapeClaim: (() => void) | null = null;

  function closeHistory() {
    if (!historyOpen) return;
    historyOpen = false;
    // Release synchronously so the escape coordinator's "close one layer per
    // Escape" contract holds even before Svelte flushes the effect cleanup.
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
    void tick().then(() => logButton?.focus());
  }

  function toggleHistory() {
    if (historyOpen) {
      closeHistory();
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

  function isModifiedHistoryShortcut(e: KeyboardEvent) {
    return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing;
  }

  $effect(() => {
    if (!historyOpen) return;
    releaseEscapeClaim = claimEscape(closeHistory);
    return () => {
      releaseEscapeClaim?.();
      releaseEscapeClaim = null;
    };
  });

  function handleKey(e: KeyboardEvent) {
    if (e.repeat) return;

    if (e.key === "l" || e.key === "L") {
      if (isModifiedHistoryShortcut(e)) return;
      if (historyOpen) {
        e.preventDefault();
        toggleHistory();
        return;
      }
      if (isShortcutBlockedByFocusedControl()) return;
      e.preventDefault();
      toggleHistory();
      return;
    }

    if (e.key !== " " && e.key !== "Enter") return;
    if (historyOpen) {
      // Don't swallow Space/Enter when focus is inside the history panel —
      // let native button activation (the close button) proceed. Only
      // preventDefault elsewhere to stop page scroll / dialogue advance.
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.closest(".history-panel")) {
        return;
      }
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

<div class="portrait-shell">
  <CrossfadeImage
    src={current.kind === "line" ? (portraitAsset?.url ?? null) : null}
    alt=""
    ariaHidden={true}
    imageClass={`portrait ${portraitPlacement}`}
    dataAttributes={{
      placement: portraitPlacement,
      layer: "behind-dialogue",
    }}
    imageStyle="--portrait-height: min(1536px, 80vh);"
    onImageError={handlePortraitError}
  />
</div>

{#if historyOpen}
  <DialogueHistoryPanel {history} onClose={closeHistory} />
{/if}

<div class="wrapper" class:line={current.kind === "line"}>
  <button
    bind:this={logButton}
    class="log-button"
    type="button"
    aria-label="開啟對話紀錄"
    aria-pressed={historyOpen}
    onclick={handleLogButtonClick}
  >
    LOG
  </button>

  <!--
    When `crossExam` is set, the inline 反駁/退下 <button>s render inside this
    box. Giving the box `role="button"` then would nest buttons inside a button
    (screen readers announce "button inside button"), so the role/tabindex/
    aria-label are dropped in that branch — the cross-exam buttons become the
    only announced interactive controls, and the 繼續聆聽 Space/Enter advance
    still works via the window-level handleKey (when nothing is focused) and
    via mouse click on the box. The svelte-ignore below is a false positive:
    `role` and `tabindex` are keyed on the same `crossExam` flag, so the div is
    never noninteractive while carrying a nonnegative tabindex.
  -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class="box"
    class:scene={current.kind === "sceneTag"}
    class:action={current.kind === "action"}
    class:line={current.kind === "line"}
    role={crossExam ? undefined : "button"}
    tabindex={crossExam ? undefined : 0}
    onclick={handleClick}
    onkeydown={handleBoxKeydown}
    aria-label={crossExam ? undefined : "推進對話"}
    aria-disabled={disabled}
    inert={historyOpen}
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

    {#if crossExam}
      <div class="xexam-actions">
        <button
          class="xexam-challenge"
          type="button"
          {disabled}
          onclick={handleChallengeClick}
        >
          <span class="act-mark">▸</span>
          反駁
        </button>
        <button
          class="xexam-withdraw"
          type="button"
          {disabled}
          onclick={handleWithdrawClick}
        >
          退下
        </button>
      </div>
    {/if}

    <div class="hint">
      <span class="key">Space</span>
      <span class="arrow">▶</span>
      {#if crossExam}
        <span class="hint-label">繼續聆聽</span>
      {/if}
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

  .portrait-shell :global(img.portrait) {
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

  .portrait-shell :global(img.portrait.left) {
    left: 0;
    transform: none;
  }

  .portrait-shell :global(img.portrait.right) {
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

  .hint-label {
    font-family: var(--serif-jp);
    letter-spacing: 0.12em;
    color: var(--bone-faint);
    text-transform: none;
  }

  /* inline cross-examination controls */
  .xexam-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  .xexam-actions button {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 7px 14px 6px;
    background: transparent;
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
    transition:
      border-color 0.18s,
      background 0.18s,
      color 0.18s;
  }

  .xexam-actions button:hover:not(:disabled),
  .xexam-actions button:focus-visible:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: none;
  }

  .xexam-challenge {
    color: var(--crimson);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .xexam-withdraw {
    color: var(--bone-faint);
  }

  .xexam-actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .act-mark {
    color: var(--crimson);
  }
</style>
