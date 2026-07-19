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

  const dialogueTransitionDurationMs = 1500;
  const textRevealTickMs = 25;
  // Per-character floor so short lines finish faster than the full transition
  // duration. The effective reveal duration is `min(text.length * this, cap)`,
  // where the cap is `textRevealDurationMs` (default 1500ms). Long lines still
  // hit the cap; short lines feel snappier instead of dragging out the full
  // 1500ms.
  const minMsPerChar = 40;

  let {
    current,
    queueToken,
    onAdvance,
    onAdvanceFeedback,
    history = [],
    disabled = false,
    crossExam = null,
    textRevealDurationMs = dialogueTransitionDurationMs,
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
    textRevealDurationMs?: number;
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
  let advanceButton: HTMLButtonElement | undefined = $state();
  let visibleTextLength = $state(0);
  let textRevealTimer: ReturnType<typeof setInterval> | null = null;
  const portraitAssetId = $derived(
    current.kind === "line" ? (current.portrait?.assetId ?? null) : null,
  );
  const portraitPlacement = $derived(
    current.kind === "line"
      ? placementForPortrait(current.portrait?.characterId)
      : "left",
  );
  const portraitSource = $derived(
    current.kind === "line" ? (portraitAsset?.url ?? null) : null,
  );
  const portraitTransitionKey = $derived(
    portraitSource ? `${portraitSource}:${portraitPlacement}` : null,
  );
  const revealableText = $derived(
    current.kind === "line" || current.kind === "action" ? current.text : "",
  );
  const revealKey = $derived(
    `${queueToken.sceneId}:${queueToken.queueGen}:${queueToken.cursor}:${current.kind}:${
      current.kind === "line" ? current.speaker : ""
    }:${revealableText}`,
  );
  const visibleDialogueText = $derived(
    textRevealDurationMs <= 0
      ? revealableText
      : revealableText.slice(0, visibleTextLength),
  );
  const textRevealActive = $derived(
    textRevealDurationMs > 0 &&
      revealableText.length > 0 &&
      visibleTextLength < revealableText.length,
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

  function clearTextRevealTimer() {
    if (!textRevealTimer) return;
    clearInterval(textRevealTimer);
    textRevealTimer = null;
  }

  function completeTextRevealIfNeeded() {
    if (!textRevealActive) return false;
    clearTextRevealTimer();
    visibleTextLength = revealableText.length;
    return true;
  }

  function dispatchAdvance() {
    onAdvanceFeedback?.();
    if (disabled) return;
    onAdvance(queueToken);
  }

  function handleClick() {
    if (historyOpen) return;
    if (completeTextRevealIfNeeded()) {
      onAdvanceFeedback?.();
      return;
    }
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

  function closeHistory({ refocusLog = true } = {}) {
    if (!historyOpen) return;
    historyOpen = false;
    // Release synchronously so the escape coordinator's "close one layer per
    // Escape" contract holds even before Svelte flushes the effect cleanup.
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
    if (refocusLog) {
      void tick().then(() => logButton?.focus());
    } else {
      // Closing via the L shortcut returns the user to dialogue mode, where
      // Space/Enter should advance dialogue. If we refocus the LOG button,
      // the browser's default Space-activates-focused-button behavior would
      // synthesize a click on it (handleKey returns without preventDefault
      // when a button is focused), re-opening history instead of advancing.
      // Blur whatever inside the panel had focus so activeElement falls back
      // to body, where the window-level Space/Enter handler advances.
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    }
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
    '[role="dialog"]',
    '[contenteditable="true"]',
  ].join(",");

  function isAdvanceBlockedByFocusedControl() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      return false;
    }
    return Boolean(active.closest(interactiveFocusSelector));
  }

  function isHistoryShortcutBlockedByFocusedControl() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      return false;
    }
    // LOG, cross-examination, and the SR advance button are all part of this
    // dialogue surface, so L remains available while any of them is focused.
    // Other native controls keep their normal text-entry/activation behavior.
    if (
      active === logButton ||
      active === advanceButton ||
      active.closest(".box")
    )
      return false;
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

  $effect(() => {
    // Read revealKey so this effect re-runs when the reveal target changes;
    // the value itself is not needed beyond dependency tracking.
    void revealKey;
    const text = revealableText;
    const duration = textRevealDurationMs;

    clearTextRevealTimer();
    if (text.length === 0 || duration <= 0) {
      visibleTextLength = text.length;
      return;
    }

    // Short lines finish faster: cap the reveal duration at
    // `text.length * minMsPerChar` when that is below the configured duration.
    const effectiveDuration = Math.min(text.length * minMsPerChar, duration);

    // Respect prefers-reduced-motion: skip the JS typewriter and reveal the
    // full line immediately. Mirrors CrossfadeImage's reduced-motion handling.
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      visibleTextLength = text.length;
      return;
    }

    visibleTextLength = 0;
    const startedAt = Date.now();
    textRevealTimer = setInterval(() => {
      const elapsed = Date.now() - startedAt;
      visibleTextLength = Math.min(
        text.length,
        Math.floor((elapsed / effectiveDuration) * text.length),
      );
      if (visibleTextLength >= text.length) {
        clearTextRevealTimer();
      }
    }, textRevealTickMs);

    return clearTextRevealTimer;
  });

  function handleKey(e: KeyboardEvent) {
    if (e.repeat) return;

    if (e.key === "l" || e.key === "L") {
      if (isModifiedHistoryShortcut(e)) return;
      if (historyOpen) {
        e.preventDefault();
        // Close via the L shortcut returns the user to dialogue mode: blur
        // rather than refocus the LOG button so a subsequent Space advances
        // dialogue instead of re-activating LOG.
        closeHistory({ refocusLog: false });
        return;
      }
      if (isHistoryShortcutBlockedByFocusedControl()) return;
      e.preventDefault();
      openHistory();
      return;
    }

    if (e.key !== " " && e.key !== "Enter") return;
    // IME composition fires Space/Enter with isComposing=true; advancing
    // mid-composition would corrupt CJK input. No text inputs exist in the
    // dialogue flow so this is low-risk, but guard for correctness.
    if (e.isComposing) return;
    if (historyOpen) {
      // While history is open, Space/Enter must neither advance dialogue nor
      // activate the focused CLOSE button — the popup closes only via the L
      // shortcut or a mouse click on CLOSE. Swallow both keys entirely so the
      // browser does not synthesize a click on the auto-focused CLOSE button.
      e.preventDefault();
      return;
    }
    if (isAdvanceBlockedByFocusedControl()) return;
    e.preventDefault();
    if (completeTextRevealIfNeeded()) {
      onAdvanceFeedback?.();
      return;
    }
    dispatchAdvance();
  }
</script>

<!--
  This window-level keydown handler advances dialogue on Space/Enter.
  Escape is deliberately NOT handled here: it is reserved by GameShell's
  capture-phase handler as the sole entry point for opening the game menu,
  which calls stopImmediatePropagation() so Escape never reaches this handler
  while the menu is open. Do NOT add Escape handling here — it would race the
  menu toggle and reintroduce the conflict. See GameShell.svelte onMount.
-->
<svelte:window onkeydown={handleKey} />

<div class="portrait-shell">
  <CrossfadeImage
    src={portraitSource}
    transitionKey={portraitTransitionKey}
    alt=""
    ariaHidden={true}
    durationMs={dialogueTransitionDurationMs}
    imageClass={`portrait ${portraitPlacement}`}
    dataAttributes={{
      placement: portraitPlacement,
      // Stable hook for tests/e2e to locate the dialogue portrait layer
      // (asserted in DialogueBox.test.ts and app.spec.ts). Not consumed by
      // production CSS, which keys off the .portrait/.left/.right classes.
      layer: "behind-dialogue",
    }}
    imageStyle="--portrait-height: min(1536px, 80vh);"
    onImageError={handlePortraitError}
  />
</div>

{#if historyOpen}
  <!-- Dim the gameplay behind the history popup. pointer-events: none keeps
       existing click targets (e.g. the LOG button) reachable so the popup
       can still be toggled; the backdrop is purely visual. -->
  <div class="history-backdrop" aria-hidden="true"></div>
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

  <!-- Keyboard advance is global; the dialogue surface itself is click-only
       so it does not become a selectable/focusable control. This avoids a
       nested-button role conflict (LOG / cross-exam buttons live inside it).
       The sibling .advance-button below restores a Tab-reachable, SR-announced
       advance target without nesting a button inside .box. Sighted keyboard
       users still rely on the global Space/Enter handler; the visually-hidden
       button exists for screen-reader users and as the e2e anchor.

       This button uses aria-disabled (not the native disabled attribute) so
       it remains Tab-focusable and SR-announced while signalling the disabled
       state — screen-reader users need a reachable advance target even while
       a command is in flight (disabled mirrors gameState.inFlight). The
       cross-examination buttons below, by
       contrast, use the native disabled attribute because they are optional
       affordances that should drop out of the tab order when unavailable. -->
  <button
    class="advance-button sr-only"
    type="button"
    aria-label="推進對話"
    aria-disabled={disabled}
    inert={historyOpen}
    bind:this={advanceButton}
    onclick={handleClick}>推進對話</button
  >
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="box"
    class:scene={current.kind === "sceneTag"}
    class:action={current.kind === "action"}
    class:line={current.kind === "line"}
    class:disabled
    onclick={handleClick}
    inert={historyOpen}
  >
    {#if current.kind === "sceneTag"}
      <span class="kind">場 · SCENE</span>
      <p class="text-scene">（場景切換）</p>
    {:else if current.kind === "action"}
      <span class="kind">敘述 · NARRATION</span>
      <p class="text-action">{visibleDialogueText}</p>
    {:else if current.kind === "line"}
      <div class="line-grid">
        <div class="speaker-block">
          <span class="kind">發言 · LINE</span>
          <span class="speaker">{current.speaker}</span>
        </div>
        <p class="text-line">{visibleDialogueText}</p>
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

  /* Un-hide the sr-only advance button when keyboard focus lands on it so
     sighted keyboard users get a visible focus target (WCAG 2.4.7). The
     button is normally invisible because the dialogue surface is click-only
     and Space/Enter advance is handled at the window level; this restores
     the focus ring only for keyboard navigation, not for mouse clicks.
     Anchored to the bottom-right of the wrapper so it clears the top-left
     kind label (敘述/發言) and the top-right LOG button; cross-exam buttons
     (反駁/退下) are bottom-left. The bottom-right corner hosts the Space ▶
     hint, so the pill is lifted above it (bottom: 30px) to avoid overlap. */
  .advance-button.sr-only:focus-visible {
    position: absolute;
    width: auto;
    height: auto;
    padding: 6px 14px;
    margin: 0;
    overflow: visible;
    clip-path: none;
    white-space: normal;
    bottom: 30px;
    right: 18px;
    z-index: 2;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
    outline: 2px solid var(--crimson);
    outline-offset: 2px;
  }

  .wrapper {
    --dialogue-width: min(960px, calc(100vw - 56px));
    position: fixed;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
    width: var(--dialogue-width);
    z-index: 30;
  }

  /* Sits above the dialogue box (z-index 30) and portrait (z-index 20) but
     below the history panel (z-index 35) so the popup stays fully visible
     while the gameplay behind it is dimmed. pointer-events: none so clicks
     pass through to the LOG button / dialogue surface behind. */
  .history-backdrop {
    position: fixed;
    inset: 0;
    z-index: 32;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
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

  .box:hover:not(.disabled) {
    border-color: var(--crimson);
    background: rgba(29, 29, 43, 0.96);
  }

  .box.disabled {
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
