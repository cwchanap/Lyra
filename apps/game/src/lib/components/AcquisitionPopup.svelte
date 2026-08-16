<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    placeholderForStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import type { PendingAcquisitionView } from "$lib/state/types";

  let {
    notification,
    busy,
    error = null,
    returnFocusTo = null,
    fallbackFocusTarget = null,
    onContinue,
  }: {
    notification: PendingAcquisitionView;
    busy: boolean;
    error?: string | null;
    returnFocusTo?: HTMLElement | null;
    fallbackFocusTarget?: HTMLElement | null;
    onContinue: (eventId: string) => Promise<void>;
  } = $props();

  let acquisitionCard: HTMLDivElement | undefined = $state();
  let continueButton: HTMLButtonElement | undefined = $state();
  let evidenceImage: ResolvedStoryAsset | null = $state(null);
  let focusTarget: HTMLElement | null = null;
  let fallbackTarget: HTMLElement | null = null;
  let releaseEscapeClaim: (() => void) | null = null;

  const heading = $derived(
    notification.recordKind === "evidence" ? "物證取得" : "證言取得",
  );
  const eyebrow = $derived(
    notification.recordKind === "evidence"
      ? "EVIDENCE ACQUIRED"
      : "STATEMENT ACQUIRED",
  );

  // Guard against stale async results: if the notification changes (via
  // {#key} remount or effect re-run) before the asset resolves, the cleanup
  // sets `cancelled` and the key check prevents the old promise from
  // overwriting `evidenceImage` with the previous item's asset.
  $effect(() => {
    const eventId = notification.id;
    let cancelled = false;
    if (notification.recordKind !== "evidence") {
      evidenceImage = null;
      return;
    }

    const assetId = notification.imageAssetId;
    if (!assetId) {
      evidenceImage = placeholderForStoryAsset("evidence");
      return;
    }

    evidenceImage = null;
    resolveStoryAsset(assetId, "evidence")
      .then((asset) => {
        if (!cancelled && notification.id === eventId) {
          evidenceImage = asset;
        }
      })
      .catch(() => {
        if (!cancelled && notification.id === eventId) {
          evidenceImage = placeholderForMissingStoryAsset(assetId, "evidence");
        }
      });

    return () => {
      cancelled = true;
    };
  });

  $effect(() => {
    const eventId = notification.id;
    void tick().then(() => {
      if (notification.id !== eventId) return;
      if (!busy) continueButton?.focus();
    });
  });

  function dismissCurrent() {
    if (busy) return;
    void onContinue(notification.id);
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || !acquisitionCard) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const controls = Array.from(
      acquisitionCard.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    if (controls.length === 0) {
      acquisitionCard.focus();
      return;
    }

    const activeIndex = controls.findIndex(
      (control) => control === document.activeElement,
    );
    const nextIndex =
      activeIndex < 0
        ? event.shiftKey
          ? controls.length - 1
          : 0
        : (activeIndex + (event.shiftKey ? -1 : 1) + controls.length) %
          controls.length;
    controls[nextIndex]?.focus();
  }

  function handleImageError() {
    if (!evidenceImage || evidenceImage.placeholder) return;
    evidenceImage = placeholderForMissingStoryAsset(
      evidenceImage.assetId,
      "evidence",
    );
  }

  onMount(() => {
    focusTarget = returnFocusTo;
    fallbackTarget = fallbackFocusTarget;
    releaseEscapeClaim = claimEscape(dismissCurrent);
    window.addEventListener("keydown", handleKeydown, { capture: true });
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown, { capture: true });
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
    const target = focusTarget;
    const fallback = fallbackTarget;
    void tick().then(() => {
      // Treat document.body as a non-target: when the popup is advanced by a
      // pointer click on the click-only .box, document.activeElement can be
      // document.body and the page stores that as returnFocusTo. body.isConnected
      // is true, so without this guard focus restoration would land on body and
      // never reach fallbackFocusTarget, leaving keyboard/SR users without a
      // gameplay focus target after dismissing the popup.
      if (target && target.isConnected && target !== document.body) {
        target.focus();
      } else if (fallback?.isConnected) {
        fallback.focus();
      }
    });
  });
</script>

<div class="acquisition-scrim">
  {#key notification.id}
    <div
      bind:this={acquisitionCard}
      class="acquisition-card"
      role="dialog"
      tabindex="-1"
      aria-modal="true"
      aria-labelledby="acquisition-heading"
      aria-describedby="acquisition-description"
    >
      <header>
        <p class="eyebrow">{eyebrow}</p>
        <h2 id="acquisition-heading">{heading}</h2>
      </header>

      <div class="acquisition-body">
        <div class="visual" aria-hidden="true">
          {#if notification.recordKind === "evidence" && evidenceImage}
            <img
              class="evidence-image"
              src={evidenceImage.url}
              alt=""
              onerror={handleImageError}
            />
          {:else if notification.recordKind === "statement"}
            <div class="statement-seal">證</div>
          {/if}
        </div>

        <div class="copy">
          <p class="item-title">{notification.title}</p>
          <p
            id="acquisition-description"
            class:statement-content={notification.recordKind === "statement"}
          >
            {notification.description}
          </p>
        </div>
      </div>

      <div class="failure-actions">
        {#if error}
          <p class="failure-message" role="alert">{error}</p>
        {/if}
        <button
          bind:this={continueButton}
          class="continue-button"
          type="button"
          disabled={busy}
          onclick={dismissCurrent}
        >
          {busy ? "儲存中…" : "CONTINUE / 繼續"}
        </button>
      </div>
    </div>
  {/key}
</div>

<style>
  .acquisition-scrim {
    position: fixed;
    inset: 0;
    z-index: 120;
    display: grid;
    place-items: center;
    padding: 28px;
    background: rgba(4, 5, 10, 0.78);
  }

  .acquisition-card {
    width: min(760px, calc(100vw - 56px));
    max-height: min(620px, calc(100dvh - 56px));
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto minmax(0, 1fr) auto;
    gap: 22px;
    padding: 28px;
    overflow: hidden;
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--crimson);
    background: rgba(12, 13, 22, 0.99);
    color: var(--bone);
    box-shadow: 0 28px 90px rgba(0, 0, 0, 0.7);
    animation: acquisition-enter 180ms ease-out both;
  }

  header,
  .copy {
    min-width: 0;
  }

  h2,
  p {
    margin: 0;
  }

  .eyebrow,
  .continue-button {
    font-family: var(--impact);
    letter-spacing: 0.2em;
  }

  .eyebrow {
    margin-bottom: 8px;
    color: var(--crimson);
    font-size: 11px;
  }

  h2 {
    font-family: var(--display-jp);
    font-size: clamp(26px, 4vw, 40px);
    font-weight: 400;
    letter-spacing: 0.08em;
  }

  .acquisition-body {
    min-height: 0;
    display: grid;
    grid-template-columns: minmax(180px, 240px) minmax(0, 1fr);
    gap: 26px;
    align-items: center;
  }

  .visual {
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    overflow: hidden;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.035);
  }

  .evidence-image {
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .statement-seal {
    width: 62%;
    aspect-ratio: 1;
    display: grid;
    place-items: center;
    border: 2px solid var(--cyan);
    color: var(--cyan);
    font-family: var(--display-jp);
    font-size: clamp(52px, 9vw, 84px);
    transform: rotate(-4deg);
    box-shadow: inset 0 0 0 8px rgba(67, 205, 213, 0.06);
  }

  .copy {
    display: grid;
    gap: 14px;
  }

  .item-title {
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: clamp(22px, 3vw, 32px);
    overflow-wrap: anywhere;
  }

  #acquisition-description {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 16px;
    line-height: 1.75;
    overflow-wrap: anywhere;
  }

  #acquisition-description.statement-content {
    max-height: min(220px, 32dvh);
    overflow-y: auto;
  }

  .failure-actions {
    display: grid;
    gap: 10px;
    justify-items: end;
  }

  .failure-message {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 14px;
    line-height: 1.6;
  }

  .continue-button {
    justify-self: end;
    min-width: 190px;
    min-height: 44px;
    padding: 11px 18px;
    border: 1px solid var(--rule-strong);
    background: var(--crimson-soft);
    color: var(--bone);
    cursor: pointer;
  }

  .continue-button:hover,
  .continue-button:focus-visible {
    border-color: var(--crimson);
    background: rgba(174, 28, 49, 0.3);
    outline: 2px solid var(--cyan);
    outline-offset: 3px;
  }

  .continue-button:disabled {
    cursor: default;
    opacity: 0.65;
  }

  @keyframes acquisition-enter {
    from {
      opacity: 0;
      transform: scale(0.97);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }

  @media (max-width: 640px) {
    .acquisition-scrim {
      padding: 18px;
    }

    .acquisition-card {
      width: calc(100vw - 36px);
      max-height: calc(100dvh - 36px);
      gap: 16px;
      padding: 20px;
    }

    .acquisition-body {
      grid-template-columns: 1fr;
      gap: 16px;
    }

    .visual {
      width: min(210px, 55vw);
      justify-self: center;
    }

    .continue-button {
      width: 100%;
      justify-self: stretch;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .acquisition-card {
      animation: none;
    }
  }
</style>
