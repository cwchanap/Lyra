<script lang="ts">
  import { onDestroy, tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import CrossfadeImage from "./CrossfadeImage.svelte";
  import DialogueHistoryOverlay from "./DialogueHistoryOverlay.svelte";
  import type {
    DialogueHistoryEntry,
    DialogueItem,
    QueueToken,
    CrossExamView,
  } from "../state/types";

  const dialogueTransitionDurationMs = 1500;
  const textRevealTickMs = 25;
  const challengeHoldDurationMs = 600;
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
    interrogationStageActive = false,
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
      presentation?: CrossExamView | null;
    } | null;
    interrogationStageActive?: boolean;
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
  let wrapper: HTMLDivElement | undefined = $state();
  // History panel bottom offset, updated from the wrapper's actual height
  // when history opens (and on wrapper resize while open) so the panel
  // always clears the LOG button even when the dialogue box grows past its
  // 160px min-height. Default 180 matches the fallback in the panel.
  let historyPanelBottom = $state(180);
  let visibleTextLength = $state(0);
  let textRevealTimer: ReturnType<typeof setInterval> | null = null;
  let challengeHoldTimer: ReturnType<typeof setTimeout> | null = null;
  let challengeSuppressionTimer: ReturnType<typeof setTimeout> | null = null;
  let heldChallengePointerId: number | null = null;
  let suppressNextPhysicalChallengeClick = false;
  let challengeCharging = $state(false);
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
  const interrogationTestimony = $derived(
    interrogationStageActive && crossExam?.presentation != null,
  );
  const testimonyCounter = $derived.by(() => {
    const presentation = crossExam?.presentation;
    /* v8 ignore next -- unreachable: testimonyCounter is only read when interrogationTestimony is true, which requires crossExam.presentation != null */
    if (!presentation) return "";
    return `${String(presentation.lineIndex + 1).padStart(2, "0")} / ${String(
      presentation.lineTotal,
    ).padStart(2, "0")} ↻`;
  });
  const advanceLabel = $derived(
    interrogationTestimony ? "推進證詞" : "推進對話",
  );
  const crossExamLineLabel = $derived(
    /* v8 ignore next -- template concatenation artifact: only rendered inside the crossExam.presentation guard */
    crossExam?.presentation
      ? `證詞 ${crossExam.presentation.lineIndex + 1} / ${crossExam.presentation.lineTotal}`
      : "",
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

  function handleAdvanceButtonClick(event: MouseEvent) {
    event.stopPropagation();
    handleClick();
  }

  function invokeChallenge() {
    if (disabled || !crossExam) return;
    crossExam.onChallenge(crossExam.lineId);
  }

  function clearChallengeHold() {
    if (challengeHoldTimer) {
      clearTimeout(challengeHoldTimer);
      challengeHoldTimer = null;
    }
    heldChallengePointerId = null;
    challengeCharging = false;
  }

  function clearChallengeClickSuppression() {
    if (challengeSuppressionTimer) {
      clearTimeout(challengeSuppressionTimer);
      challengeSuppressionTimer = null;
    }
    suppressNextPhysicalChallengeClick = false;
  }

  function armChallengeClickSuppression() {
    clearChallengeClickSuppression();
    suppressNextPhysicalChallengeClick = true;
  }

  function suppressFollowingPhysicalChallengeClick() {
    armChallengeClickSuppression();
    // A pointer sequence normally dispatches click before the event loop
    // advances. If it does not (for example, pointercancel/leave), clear the
    // one-shot guard on the next turn so it cannot swallow a later click.
    challengeSuppressionTimer = setTimeout(() => {
      suppressNextPhysicalChallengeClick = false;
      challengeSuppressionTimer = null;
    }, 0);
  }

  function handleChallengePointerDown(event: PointerEvent) {
    if (disabled || !crossExam) return;

    // Only the primary button (left) should arm the hold timer. Secondary
    // (right) and middle buttons never activate a native button, so arming
    // the 600 ms hold on them would submit a challenge through a path the
    // browser's own activation semantics reject.
    if (event.button !== 0) return;

    clearChallengeHold();
    clearChallengeClickSuppression();
    heldChallengePointerId = event.pointerId;
    challengeCharging = true;
    challengeHoldTimer = setTimeout(() => {
      if (heldChallengePointerId !== event.pointerId) return;

      challengeHoldTimer = null;
      challengeCharging = false;
      // Keep the pointer id until its release. A completed hold may last well
      // beyond this timer, while the physical click arrives only after
      // pointerup; release schedules the one-shot suppression cleanup.
      armChallengeClickSuppression();
      invokeChallenge();
    }, challengeHoldDurationMs);
  }

  function cancelChallengePointerSequence(event: PointerEvent) {
    if (heldChallengePointerId !== event.pointerId) return;

    clearChallengeHold();
    suppressFollowingPhysicalChallengeClick();
  }

  // Cross-exam buttons share the dialogue surface, so each stops propagation
  // to keep its activation from advancing the testimony.
  function handleChallengeClick(event: MouseEvent) {
    event.stopPropagation();
    if (disabled || !crossExam) return;

    // detail > 0 identifies a physical pointer click. Direct keyboard,
    // assistive technology, and packaged-E2E button.click() activation use
    // detail === 0 and keep their native immediate behavior.
    if (event.detail > 0 && suppressNextPhysicalChallengeClick) {
      clearChallengeClickSuppression();
      return;
    }

    invokeChallenge();
  }

  function handleWithdrawClick(e: MouseEvent) {
    e.stopPropagation();
    if (disabled || !crossExam) return;
    crossExam.onWithdraw();
  }

  onDestroy(() => {
    clearChallengeHold();
    clearChallengeClickSuppression();
  });

  // The LOG button is a native <button>, so Space/Enter activation is delivered
  // as a synthesized click (with detail 0). AT click activation (e.g. VoiceOver
  // VO+Space, programmatic .click()) also produces detail 0. Treat the click
  // handler as the single activation path so all of these reach toggleHistory;
  // do NOT gate on e.detail === 0, which would drop AT activation.
  function handleLogButtonClick(e: MouseEvent) {
    e.stopPropagation();
    toggleHistory();
  }

  function updateHistoryPanelBottom() {
    if (!wrapper) return;
    // The wrapper is fixed at bottom: 28px and grows upward. Position the
    // history panel above the wrapper's actual top edge with a 12px gap so
    // the LOG button (top: 14px within the wrapper) stays mouse-clickable
    // even when the dialogue box grows past its 160px min-height (long
    // action/testimony lines that wrap).
    historyPanelBottom = 28 + wrapper.getBoundingClientRect().height + 12;
  }

  function openHistory() {
    historyOpen = true;
    updateHistoryPanelBottom();
    // The ResizeObserver that tracks wrapper resizes while history is open
    // is created/destroyed by the $effect below keyed on `historyOpen`, so
    // it is also torn down on close and on component unmount (e.g. when the
    // mode flips from dialogue to explore/interrogation while history is
    // open). We only need to seed the initial bottom offset here.
  }

  // The default is `refocusLog: false` (focus the advance button) because
  // refocusing the LOG button reintroduces the Space-reopens-history hazard:
  // Space on the focused LOG button activates it natively and toggles history
  // back open. Only the LOG-click toggle path (toggleHistory) legitimately
  // wants LOG refocus, so it passes `{ refocusLog: true }` explicitly. Any
  // future caller defaults to the safe path.
  function closeHistory({ refocusLog = false } = {}) {
    if (!historyOpen) return;
    historyOpen = false;
    // The ResizeObserver is torn down by the $effect below keyed on
    // `historyOpen` (its cleanup runs when this flips to false, and also on
    // unmount), so no manual disconnect is needed here.
    if (refocusLog) {
      void tick().then(() => logButton?.focus());
    } else {
      // Closing via the L shortcut or the CLOSE button returns the user to
      // dialogue mode. Focus the visible advance button — it is a stable,
      // Tab-reachable, AT-announced target whose own Enter/Space activation
      // advances dialogue (via handleClick → dispatchAdvance), so keyboard/AT
      // users get a named focus target ready to proceed. Wait a tick so
      // Svelte clears `inert={historyOpen}` before we focus.
      // The advance button is always rendered (it lives inside the
      // always-present .wrapper), so advanceButton is defined after mount.
      void tick().then(() => {
        advanceButton?.focus();
      });
    }
  }

  function toggleHistory() {
    if (historyOpen) {
      // LOG-click toggle: the user activated LOG to close, so return focus to
      // LOG. This is the one path that legitimately wants refocusLog: true.
      closeHistory({ refocusLog: true });
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

  function isHistoryShortcutBlockedByFocusedControl() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      return false;
    }
    // LOG, cross-examination, and the advance button are all part of this
    // dialogue surface, so L remains available while any of them is focused.
    // Other native controls keep their normal text-entry/activation behavior.
    if (
      active === logButton ||
      active === advanceButton ||
      active.closest(".box, .xexam-actions")
    )
      return false;
    return Boolean(active.closest(interactiveFocusSelector));
  }

  // Returns true when focus is on an interactive control (button, link, input,
  // etc.) so the window-level Space/Enter fallback should NOT fire — the
  // focused control's native activation owns those keys (e.g. Space on the
  // focused LOG button toggles history; Space on the focused advance button
  // advances via its own click handler). Returns false for <body> and
  // non-interactive elements, where there is no native activation to fall
  // back to, so the window-level fallback must advance dialogue. This guard
  // is what lets the global handler coexist with the visible advance button
  // without double-advancing or stealing Space from focused controls.
  function isAdvanceBlockedByFocusedControl() {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement) || active === document.body) {
      return false;
    }
    return Boolean(active.closest(interactiveFocusSelector));
  }

  function isModifiedHistoryShortcut(e: KeyboardEvent) {
    return e.metaKey || e.ctrlKey || e.altKey || e.shiftKey || e.isComposing;
  }

  // Track wrapper resizes (e.g. window resize changing text wrap) while
  // history is open so the panel stays positioned above the wrapper. The
  // cleanup runs both when `historyOpen` flips back to false (close) and when
  // the component unmounts while history is open (e.g. the mode flips from
  // dialogue to explore/interrogation), disconnecting the observer so it does
  // not outlive the wrapper element or retain the callback's component-state
  // closure.
  $effect(() => {
    if (!historyOpen) return;
    const target = wrapper;
    if (!target || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => updateHistoryPanelBottom());
    observer.observe(target);
    return () => observer.disconnect();
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
        // Close via the L shortcut returns the user to dialogue mode: focus
        // the visible advance button rather than the LOG button so a
        // subsequent Enter/Space proceeds with dialogue instead of
        // re-activating LOG.
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
    // While history is open, do not advance dialogue. We intentionally do
    // NOT swallow Space/Enter here when focus is inside the panel: the
    // history panel auto-focuses its CLOSE button on mount, and a keyboard
    // user must be able to activate it with Space/Enter (WCAG 2.1.1).
    // isAdvanceBlockedByFocusedControl returns true while focus is inside the
    // panel (CLOSE is a <button>, the list has tabindex), so the global
    // handler returns without preventDefault and the browser's native button
    // activation proceeds. Only when focus is on <body> (e.g. a race before
    // auto-focus lands) do we swallow Space/Enter to avoid advancing dialogue
    // behind the open popup.
    if (historyOpen) {
      if (isAdvanceBlockedByFocusedControl()) return;
      e.preventDefault();
      return;
    }
    // Focus is on an interactive control (the advance button, LOG, a
    // cross-exam button, or any other native control): let native activation
    // own Space/Enter. This is the no-double-advance / no-stealing-Space
    // contract. Only <body> and non-interactive elements fall through to the
    // window-level advance below — this is the focus-agnostic fallback that
    // restores Space/Enter advancement before the player has Tabbed onto the
    // advance button (which is not auto-focused on dialogue mount).
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
  This window-level keydown handler toggles dialogue history on L and
  advances dialogue on Space/Enter as a focus-agnostic fallback. Advancing
  is primarily owned by the visible .advance-button below (and the
  click-to-advance .box): press Enter/Space while the button is focused, or
  click. The Space/Enter branch here only fires when focus is on <body> or
  a non-interactive element — isAdvanceBlockedByFocusedControl returns true
  for any focused interactive control, letting native button activation own
  those keys (so Space on the focused LOG button toggles history, Space on
  the focused advance button advances via its own click, and neither
  double-advances). This restores Space/Enter advancement before the player
  has Tabbed onto the advance button, which is not auto-focused on dialogue
  mount. Escape is deliberately NOT handled here: it is reserved by
  GameShell's capture-phase handler as the sole entry point for opening the
  game menu, which calls stopImmediatePropagation() so Escape never reaches
  this handler while the menu is open. Do NOT add Escape handling here — it
  would race the menu toggle and reintroduce the conflict. See
  GameShell.svelte onMount.
-->
<svelte:window onkeydown={handleKey} />

{#if !interrogationStageActive}
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
        "save-thumbnail-asset-role": "portrait",
        // Stable hook for tests/e2e to locate the dialogue portrait layer
        // (asserted in DialogueBox.test.ts and app.spec.ts). Not consumed by
        // production CSS, which keys off the .portrait/.left/.right classes.
        layer: "behind-dialogue",
      }}
      imageStyle="--portrait-height: min(1536px, 80vh);"
      onImageError={handlePortraitError}
    />
  </div>
{/if}

{#if historyOpen}
  <DialogueHistoryOverlay
    {history}
    bottom={historyPanelBottom}
    onClose={() => closeHistory({ refocusLog: false })}
  />
{/if}

<div
  class="wrapper"
  class:line={current.kind === "line"}
  class:interrogation-stage-dialogue={interrogationStageActive}
  data-save-thumbnail-layer="over-portrait"
  bind:this={wrapper}
>
  <div
    class="dialogue-utility-row"
    class:interrogation-testimony-rail={interrogationTestimony}
  >
    {#if interrogationTestimony}
      <span class="testimony-counter">{testimonyCounter}</span>
    {/if}
    <button
      bind:this={logButton}
      class="log-button"
      class:testimony-log={interrogationTestimony}
      type="button"
      aria-label="開啟對話紀錄"
      aria-pressed={historyOpen}
      onclick={handleLogButtonClick}
    >
      LOG
    </button>
  </div>

  <!-- The dialogue surface itself is click-only so it does not become a
       selectable/focusable control. It remains a non-button container, which
       lets the testimony action row live inside it without a nested-button
       role conflict. The visible .advance-button is the Tab-reachable,
       SR-announced advance target; it is a sibling in ordinary dialogue and
       moves into the mock-shaped testimony action row during interrogation.
       Sighted keyboard users activate it with Enter/Space (native button
       activation) or click anywhere on .box.

       This button uses aria-disabled (not the native disabled attribute) so
       it remains Tab-focusable and SR-announced while signalling the disabled
       state — screen-reader users need a reachable advance target even while
       a command is in flight (disabled mirrors gameState.inFlight). The
       cross-examination buttons below, by
       contrast, use the native disabled attribute because they are optional
       affordances that should drop out of the tab order when unavailable.

       Held Space/Enter on the focused button auto-fires repeated native
       clicks (browser button-activation auto-repeat), so holding Space
       multi-advances. This is intentional (VN auto-read convention) and
       documented in DialogueBox.test.ts. The window-level handleKey has its
       own `if (e.repeat) return;` guard at the top, but it only gates the
       body-focus fallback path — when the advance button is focused,
       isAdvanceBlockedByFocusedControl returns true and handleKey returns
       without preventDefault, so native button auto-repeat proceeds
       unaffected. -->
  {#if !interrogationTestimony}
    <button
      class="advance-button"
      type="button"
      aria-label={advanceLabel}
      aria-disabled={disabled}
      inert={historyOpen}
      bind:this={advanceButton}
      onclick={handleAdvanceButtonClick}
    >
      <span class="advance-label">{advanceLabel}</span>
      <span class="advance-arrow" aria-hidden="true">▶</span>
    </button>
  {/if}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="box"
    class:scene={current.kind === "sceneTag"}
    class:action={current.kind === "action"}
    class:line={current.kind === "line"}
    class:xexam-presentation={Boolean(crossExam?.presentation)}
    class:disabled
    data-interrogation-dialogue-frame={interrogationStageActive
      ? ""
      : undefined}
    onclick={handleClick}
    inert={historyOpen}
  >
    {#if current.kind === "sceneTag"}
      <span class="kind">場 · SCENE</span>
      <p class="text-scene">（場景切換）</p>
    {:else}
      {#if current.kind === "action"}
        <span class="kind">敘述 · NARRATION</span>
        <p class="text-action">{visibleDialogueText}</p>
      {:else}
        <div class="line-grid">
          <div class="speaker-block">
            {#if interrogationStageActive}
              <span class="interrogation-kicker">證言 · TESTIMONY</span>
            {/if}
            <span class="kind">發言 · LINE</span>
            <span class="speaker">{current.speaker}</span>
          </div>
          <div class="line-content">
            <p class="text-line">{visibleDialogueText}</p>
            {#if interrogationTestimony && crossExam}
              <div class="testimony-actions">
                <button
                  class="xexam-withdraw"
                  type="button"
                  {disabled}
                  onclick={handleWithdrawClick}
                >
                  退下
                </button>
                <button
                  class="advance-button"
                  type="button"
                  aria-label={advanceLabel}
                  aria-disabled={disabled}
                  inert={historyOpen}
                  bind:this={advanceButton}
                  onclick={handleAdvanceButtonClick}
                >
                  <span class="advance-label">{advanceLabel}</span>
                  <span class="advance-arrow" aria-hidden="true">▶</span>
                </button>
              </div>
            {/if}
          </div>
        </div>
      {/if}
    {/if}

    {#if crossExam && crossExam.presentation && !interrogationTestimony}
      <div class="xexam-record" aria-label="交叉詰問進度">
        <span>{crossExam.presentation.lineLabel}</span>
        <strong>{crossExamLineLabel}</strong>
      </div>
    {/if}
  </div>

  {#if crossExam}
    <div class="xexam-actions" inert={historyOpen}>
      {#if interrogationStageActive}
        <div class="xexam-challenge-wrap">
          <button
            class="xexam-challenge"
            class:charging={challengeCharging}
            type="button"
            {disabled}
            onpointerdown={handleChallengePointerDown}
            onpointerup={cancelChallengePointerSequence}
            onpointercancel={cancelChallengePointerSequence}
            onpointerleave={cancelChallengePointerSequence}
            onclick={handleChallengeClick}
          >
            <span class="act-mark">▸</span>
            <span class="challenge-label">反駁</span>
            <span class="challenge-object">OBJECT</span>
          </button>
          <span class="hold-cue">長按</span>
        </div>
      {:else}
        <button
          class="xexam-challenge"
          class:charging={challengeCharging}
          type="button"
          {disabled}
          onpointerdown={handleChallengePointerDown}
          onpointerup={cancelChallengePointerSequence}
          onpointercancel={cancelChallengePointerSequence}
          onpointerleave={cancelChallengePointerSequence}
          onclick={handleChallengeClick}
        >
          <span class="act-mark">▸</span>
          反駁
        </button>
      {/if}
      {#if !interrogationTestimony}
        <button
          class="xexam-withdraw"
          type="button"
          {disabled}
          onclick={handleWithdrawClick}
        >
          退下
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  .dialogue-utility-row {
    position: absolute;
    top: 14px;
    right: 18px;
    z-index: 2;
  }

  .dialogue-utility-row.interrogation-testimony-rail {
    position: absolute;
    top: auto;
    right: 0;
    bottom: calc(100% + 10px);
    left: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    margin: 0;
  }

  .dialogue-utility-row.interrogation-testimony-rail .testimony-log {
    margin-right: 76px;
  }

  .testimony-counter {
    color: var(--crimson);
    font-family: var(--impact);
    font-size: 14px;
    letter-spacing: 0.18em;
  }

  /* The ordinary-dialogue advance target is anchored to the bottom-right of
     the wrapper so it clears the kind label and LOG button. Interrogation
     testimony overrides this positioning inside .testimony-actions below. */
  .advance-button {
    position: absolute;
    bottom: 14px;
    right: 18px;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 14px 6px;
    border: 1px solid var(--crimson);
    background: var(--crimson-soft);
    color: var(--bone);
    cursor: pointer;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
    transition:
      border-color 0.18s,
      background 0.18s,
      color 0.18s;
  }

  .advance-button:hover:not([aria-disabled="true"]) {
    background: rgba(174, 28, 49, 0.3);
  }

  .advance-button:focus-visible {
    outline: 2px solid var(--crimson);
    outline-offset: 2px;
  }

  .advance-button[aria-disabled="true"] {
    cursor: wait;
    opacity: 0.55;
  }

  .advance-arrow {
    color: var(--crimson);
    animation: lyra-pulse 1.6s ease-in-out infinite;
  }

  .advance-button[aria-disabled="true"] .advance-arrow {
    animation: none;
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

  .wrapper.interrogation-stage-dialogue {
    --dialogue-width: min(1000px, calc(100% - 128px));
    position: absolute;
    left: 50%;
    bottom: 28px;
    transform: translateX(-50%);
  }

  .box {
    width: 100%;
    /* Fixed min-height so the dialogue surface doesn't resize per line —
       short single-line dialogue and longer multi-line dialogue render in a
       consistent frame. 160px fits the kind label + up to ~2 wrapped lines
       with the current padding/line-height; longer text still grows. */
    min-height: 160px;
    box-sizing: border-box;
    /* Right padding clears the LOG button (top-right) AND the advance pill
       (bottom-right, ~105px wide at right:18px). Bottom padding clears the
       advance pill (~31px tall at bottom:14px). Without these insets the
       absolutely-positioned pill paints over the lower-right characters of
       deeply-wrapping lines. */
    padding: 22px 130px 50px 28px;
    display: flex;
    flex-direction: column;
    justify-content: center;
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

  .wrapper.interrogation-stage-dialogue .box {
    min-height: 196px;
    padding: 26px 28px 20px;
    background: rgba(20, 20, 31, 0.94);
    border: 1px solid rgba(236, 228, 207, 0.32);
    border-left: 3px solid var(--crimson);
    clip-path: polygon(
      0 0,
      calc(100% - 22px) 0,
      100% 22px,
      100% 100%,
      22px 100%,
      0 calc(100% - 22px)
    );
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.6);
  }

  .wrapper.interrogation-stage-dialogue .interrogation-kicker {
    display: block;
    margin-bottom: 6px;
    color: var(--crimson);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.32em;
  }

  .wrapper.interrogation-stage-dialogue .speaker-block > .kind {
    display: none;
  }

  .wrapper.interrogation-stage-dialogue .text-line {
    font-size: 16.5px;
    line-height: 1.85;
    letter-spacing: 0.03em;
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
    display: flex;
    flex-direction: column;
    justify-content: center;
  }

  .line-grid {
    display: flex;
    gap: 24px;
    align-items: stretch;
    flex: 1;
  }

  .line-content {
    display: flex;
    min-width: 0;
    flex: 1 1 auto;
    flex-direction: column;
  }

  .text-line {
    margin: 0;
    font-family: var(--serif-jp);
    font-size: 16px;
    line-height: 1.75;
    color: var(--bone);
    letter-spacing: 0.04em;
    flex: 1 1 auto;
    display: flex;
    align-items: center;
  }

  /* Narrow-screen layout. Below ~600px the side-by-side line-grid collapses:
     the fixed 140px speaker block + 22px padding + 24px gap + 130px right
     padding (clears the absolutely-positioned advance pill) leaves the text
     column only viewport-400 px wide — at 481px that's ~81px, far too narrow
     for readable dialogue. Stacking the speaker above the text gives the
     text the full content width. The previous 480px breakpoint created a
     one-pixel discontinuity where 480px stacked gave ~272px of text but 481px
     side-by-side gave ~81px. 600px ensures the side-by-side text column is at
     least ~200px (600 - 56 wrapper inset - 158 box padding - 186 speaker
     reservation), which is usable. The advance pill still needs ~125px of
     clearance from the right edge, so the right padding stays at 130px. */
  @media (max-width: 600px) {
    .box {
      padding: 18px 130px 50px 22px;
    }
    .line-grid {
      flex-direction: column;
      gap: 8px;
      align-items: stretch;
    }
    .speaker-block {
      min-width: 0;
      padding-right: 0;
      border-right: none;
      border-bottom: 1px solid var(--rule-strong);
      padding-bottom: 8px;
    }
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

  /* inline cross-examination controls */
  .box.xexam-presentation {
    border-color: rgba(174, 28, 49, 0.8);
    background:
      linear-gradient(135deg, rgba(174, 28, 49, 0.17), transparent 48%),
      rgba(20, 20, 31, 0.97);
  }

  .xexam-record {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    margin-top: 12px;
    padding-top: 10px;
    border-top: 1px solid rgba(236, 228, 207, 0.14);
  }

  .xexam-record span,
  .xexam-record strong {
    margin: 0;
    font-family: var(--impact);
    font-size: 10px;
    font-weight: 500;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .xexam-record span {
    color: var(--bone-faint);
  }

  .xexam-record strong {
    color: var(--cyan);
  }

  .xexam-actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
    margin-top: 14px;
  }

  .testimony-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    flex-wrap: wrap;
    gap: 10px;
    margin-top: 18px;
  }

  .wrapper.interrogation-stage-dialogue .xexam-actions {
    position: absolute;
    top: -64px;
    right: -64px;
    bottom: auto;
    z-index: 3;
    width: 128px;
    height: 128px;
    flex-direction: column;
    flex-wrap: nowrap;
    align-items: center;
    gap: 9px;
    margin-top: 0;
  }

  .wrapper.interrogation-stage-dialogue .xexam-challenge-wrap {
    position: absolute;
    inset: 0;
    display: flex;
    width: 128px;
    height: 128px;
    flex: 0 0 auto;
    flex-direction: column;
    align-items: center;
    gap: 9px;
    border-radius: 50%;
    background: conic-gradient(
      var(--crimson) 0deg,
      rgba(236, 228, 207, 0.14) 0deg
    );
    animation: interrogation-halo 2.1s ease-in-out infinite;
  }

  .wrapper.interrogation-stage-dialogue
    .xexam-challenge-wrap:has(.xexam-challenge.charging) {
    animation: none;
  }

  .wrapper.interrogation-stage-dialogue .xexam-challenge {
    position: absolute;
    inset: 0;
    width: 128px;
    height: 128px;
    box-sizing: border-box;
    padding: 0;
    border: 7px solid transparent;
    border-radius: 50%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    color: var(--bone);
    background: radial-gradient(
      circle at 50% 34%,
      #ae1c31,
      var(--crimson-deep) 74%
    );
    background-clip: padding-box;
    transform: none;
  }

  .wrapper.interrogation-stage-dialogue .act-mark {
    display: none;
  }

  .wrapper.interrogation-stage-dialogue .challenge-label {
    font-family: var(--display-jp);
    font-size: 25px;
    letter-spacing: 0.1em;
    line-height: 1;
  }

  .wrapper.interrogation-stage-dialogue .challenge-object {
    color: var(--bone);
    font-family: var(--impact);
    font-size: 9px;
    letter-spacing: 0.26em;
    opacity: 0.75;
  }

  .wrapper.interrogation-stage-dialogue .hold-cue {
    position: absolute;
    top: calc(100% + 9px);
    color: var(--bone-dim);
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.28em;
    animation: lyra-pulse 1.8s ease-in-out infinite;
  }

  .wrapper.interrogation-stage-dialogue .xexam-withdraw {
    position: absolute;
    top: calc(100% + 32px);
    right: 0;
    min-height: 38px;
    padding: 9px 16px 8px;
    border: 1px solid rgba(236, 228, 207, 0.18);
    background: transparent;
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
  }

  .wrapper.interrogation-stage-dialogue .testimony-actions .xexam-withdraw {
    position: static;
  }

  .wrapper.interrogation-stage-dialogue .xexam-withdraw:hover:not(:disabled),
  .wrapper.interrogation-stage-dialogue .xexam-withdraw:focus-visible {
    border-color: var(--crimson);
    background: transparent;
    color: var(--bone);
    outline: none;
  }

  .wrapper.interrogation-stage-dialogue .advance-button {
    min-height: 38px;
    padding: 9px 16px 8px;
    border: 1px solid var(--crimson);
    background: rgba(212, 20, 58, 0.12);
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
    clip-path: polygon(0 0, calc(100% - 12px) 0, 100% 12px, 100% 100%, 0 100%);
  }

  .wrapper.interrogation-stage-dialogue .testimony-actions .advance-button {
    position: static;
  }

  .wrapper.interrogation-stage-dialogue
    .advance-button:hover:not([aria-disabled="true"]) {
    background: rgba(174, 28, 49, 0.34);
  }

  @keyframes interrogation-halo {
    0%,
    100% {
      box-shadow:
        0 0 0 0 rgba(212, 20, 58, 0.5),
        0 0 26px rgba(212, 20, 58, 0.35);
    }
    50% {
      box-shadow:
        0 0 0 16px rgba(212, 20, 58, 0),
        0 0 46px rgba(212, 20, 58, 0.6);
    }
  }

  .xexam-actions button:not(.log-button),
  .testimony-actions button {
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

  .xexam-actions button:not(.log-button):hover:not(:disabled),
  .xexam-actions button:not(.log-button):focus-visible:not(:disabled),
  .testimony-actions button:hover:not(:disabled),
  .testimony-actions button:focus-visible:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: none;
  }

  .xexam-challenge {
    position: relative;
    justify-content: center;
    width: 64px;
    height: 64px;
    padding: 0;
    border-radius: 50%;
    color: var(--crimson);
    border: 2px solid var(--crimson);
    background: rgba(174, 28, 49, 0.12);
    box-shadow: inset 0 0 0 4px rgba(174, 28, 49, 0.1);
  }

  .xexam-challenge.charging {
    animation: xexam-charge 0.6s linear forwards;
  }

  @keyframes xexam-charge {
    from {
      box-shadow:
        inset 0 0 0 4px rgba(174, 28, 49, 0.1),
        0 0 0 0 rgba(174, 28, 49, 0.38);
      transform: scale(1);
    }
    to {
      box-shadow:
        inset 0 0 0 26px rgba(174, 28, 49, 0.22),
        0 0 0 10px rgba(174, 28, 49, 0);
      transform: scale(1.05);
    }
  }

  .xexam-withdraw {
    color: var(--bone-faint);
  }

  .xexam-actions button:not(.log-button):disabled,
  .testimony-actions button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  .act-mark {
    color: var(--crimson);
  }

  @media (max-width: 720px) {
    .wrapper.interrogation-stage-dialogue {
      --dialogue-width: calc(100% - 32px);
    }

    .wrapper.interrogation-stage-dialogue .xexam-actions {
      position: static;
      flex-direction: row;
      margin-top: 14px;
    }

    .wrapper.interrogation-stage-dialogue
      .xexam-actions
      button:not(.log-button) {
      min-width: 64px;
      min-height: 64px;
    }

    .wrapper.interrogation-stage-dialogue .xexam-actions {
      width: 64px;
      height: 64px;
    }

    .dialogue-utility-row.interrogation-testimony-rail .testimony-log {
      margin-right: 0;
    }

    .wrapper.interrogation-stage-dialogue .xexam-challenge-wrap {
      position: relative;
      inset: auto;
      width: 64px;
      height: 64px;
    }

    .wrapper.interrogation-stage-dialogue .xexam-challenge {
      position: absolute;
      width: 64px;
      height: 64px;
      border-width: 4px;
    }

    .wrapper.interrogation-stage-dialogue .xexam-withdraw {
      position: static;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .xexam-challenge.charging {
      animation: none;
      border-width: 3px;
      outline: 2px solid rgba(174, 28, 49, 0.5);
      outline-offset: 3px;
    }

    .wrapper.interrogation-stage-dialogue .xexam-challenge-wrap,
    .wrapper.interrogation-stage-dialogue .hold-cue {
      animation: none;
    }
  }
</style>
