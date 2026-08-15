<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { interrogationLineText } from "$lib/interrogation/presentation";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import type { CrossExamView, Inventory } from "../state/types";

  let {
    crossExam,
    inventory,
    onPresent,
    onResume,
    disabled = false,
    returnFocusTo = null,
    fallbackFocusTarget = null,
  }: {
    crossExam: CrossExamView;
    inventory: Inventory;
    onPresent: (
      lineId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void | Promise<void>;
    onResume: () => void | Promise<void>;
    disabled?: boolean;
    returnFocusTo?: HTMLElement | null;
    fallbackFocusTarget?: HTMLElement | null;
  } = $props();

  let tray: HTMLDivElement | undefined = $state();
  let evidenceImages = $state<Record<string, ResolvedStoryAsset | null>>({});
  let focusTarget: HTMLElement | null = null;
  let fallbackTarget: HTMLElement | null = null;
  let releaseEscapeClaim: (() => void) | null = null;

  $effect(() => {
    let cancelled = false;
    evidenceImages = {};

    for (const evidence of inventory.evidence) {
      const assetId = evidence.imageAssetId;
      if (!assetId) continue;

      resolveStoryAsset(assetId, "evidence")
        .then((asset) => {
          if (!cancelled && asset) {
            evidenceImages[evidence.id] = asset;
          }
        })
        .catch(() => {
          if (!cancelled) {
            evidenceImages[evidence.id] = placeholderForMissingStoryAsset(
              assetId,
              "evidence",
            );
          }
        });
    }

    return () => {
      cancelled = true;
    };
  });

  function present(kind: "evidence" | "statement", itemId: string) {
    if (disabled) return;
    void onPresent(crossExam.lineId, kind, itemId);
  }

  function resume() {
    if (disabled) return;
    void onResume();
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || !tray) return;
    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const controls = Array.from(
      tray.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    if (controls.length === 0) {
      tray.focus();
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

  function handleEvidenceImageError(itemId: string) {
    const image = evidenceImages[itemId];
    if (!image || image.placeholder) return;

    evidenceImages[itemId] = placeholderForMissingStoryAsset(
      image.assetId,
      "evidence",
    );
  }

  onMount(() => {
    focusTarget = returnFocusTo;
    fallbackTarget = fallbackFocusTarget;
    releaseEscapeClaim = claimEscape(resume);
    window.addEventListener("keydown", handleKeydown, { capture: true });
    void tick().then(() => {
      tray?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    });
  });

  onDestroy(() => {
    window.removeEventListener("keydown", handleKeydown, { capture: true });
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;

    const target = focusTarget;
    const fallback = fallbackTarget;
    void tick().then(() => {
      if (target && target.isConnected && target !== document.body) {
        target.focus();
      } else if (fallback?.isConnected) {
        fallback.focus();
      }
    });
  });
</script>

<div class="interrogation-tray-scrim">
  <div
    bind:this={tray}
    class="interrogation-evidence-tray"
    role="dialog"
    aria-modal="true"
    aria-labelledby="interrogation-evidence-heading"
    aria-describedby="interrogation-evidence-line"
    tabindex="-1"
  >
    <header>
      <p class="eyebrow">PRESENT / 提出證據</p>
      <h2 id="interrogation-evidence-heading">提出證據</h2>
      <p class="progress">
        證詞 {crossExam.lineIndex + 1} / {crossExam.lineTotal}
      </p>
    </header>

    <blockquote id="interrogation-evidence-line" class="line-record">
      {interrogationLineText(crossExam.lineContent)}
    </blockquote>

    <section aria-label="可提出的紀錄" class="record-list">
      {#each inventory.evidence as item (item.id)}
        <button
          class="record-card evidence-card"
          type="button"
          {disabled}
          onclick={() => present("evidence", item.id)}
        >
          <span class="record-visual" aria-hidden="true">
            {#if evidenceImages[item.id]}
              <img
                src={evidenceImages[item.id]?.url}
                alt=""
                onerror={() => handleEvidenceImageError(item.id)}
              />
            {:else}
              <span class="record-seal">證</span>
            {/if}
          </span>
          <span class="record-copy">
            <span class="record-kind">物證 / EVIDENCE</span>
            <strong>{item.name}</strong>
            <span>{item.description}</span>
            <small>{item.details}</small>
          </span>
        </button>
      {/each}

      {#each inventory.statements as item (item.id)}
        <button
          class="record-card statement-card"
          type="button"
          {disabled}
          onclick={() => present("statement", item.id)}
        >
          <span class="record-visual statement-seal" aria-hidden="true">言</span
          >
          <span class="record-copy">
            <span class="record-kind">證言 / STATEMENT</span>
            <strong>{item.speaker}</strong>
            <span>{item.content}</span>
          </span>
        </button>
      {/each}
    </section>

    <footer>
      <p>選擇一項紀錄以反駁目前證詞。</p>
      <button class="withdraw" type="button" {disabled} onclick={resume}>
        收回
      </button>
    </footer>
  </div>
</div>

<style>
  .interrogation-tray-scrim {
    position: fixed;
    z-index: 35;
    inset: 0;
    display: grid;
    place-items: center;
    padding: 24px;
    background:
      linear-gradient(rgba(5, 5, 9, 0.78), rgba(5, 5, 9, 0.9)),
      repeating-linear-gradient(
        to bottom,
        transparent 0,
        transparent 4px,
        rgba(0, 0, 0, 0.24) 5px
      );
    backdrop-filter: blur(7px);
  }

  .interrogation-evidence-tray {
    box-sizing: border-box;
    display: grid;
    grid-template-rows: auto auto minmax(0, 1fr) auto;
    gap: 18px;
    width: min(760px, calc(100vw - 48px));
    max-height: min(760px, calc(100dvh - 48px));
    padding: clamp(20px, 3vw, 32px);
    overflow: hidden;
    border: 1px solid var(--rule-strong);
    border-top: 3px solid var(--crimson);
    background:
      linear-gradient(135deg, rgba(74, 11, 22, 0.22), transparent 36%),
      rgba(9, 9, 15, 0.98);
    box-shadow:
      0 28px 100px rgba(0, 0, 0, 0.58),
      inset 0 0 0 1px rgba(236, 228, 207, 0.05);
  }

  header,
  footer {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }

  .eyebrow,
  h2,
  .progress,
  .line-record,
  footer p {
    margin: 0;
  }

  .eyebrow,
  .record-kind,
  .progress {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .eyebrow {
    color: var(--crimson);
  }

  h2 {
    position: absolute;
    clip: rect(0 0 0 0);
    clip-path: inset(50%);
    width: 1px;
    height: 1px;
    overflow: hidden;
    white-space: nowrap;
  }

  .progress {
    color: var(--cyan);
    text-align: right;
  }

  .line-record {
    padding: 14px 16px;
    border-left: 2px solid var(--crimson);
    background: rgba(236, 228, 207, 0.05);
    color: var(--bone);
    font-family: var(--serif-jp);
    font-size: clamp(16px, 2vw, 20px);
    line-height: 1.7;
  }

  .record-list {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .record-card {
    display: grid;
    grid-template-columns: 52px minmax(0, 1fr);
    gap: 12px;
    width: 100%;
    padding: 13px;
    border: 1px solid var(--rule-strong);
    background: rgba(236, 228, 207, 0.04);
    color: var(--bone);
    font: inherit;
    text-align: left;
    cursor: pointer;
    transition:
      transform 0.16s ease,
      border-color 0.16s ease,
      background 0.16s ease;
  }

  .record-card:hover:not(:disabled),
  .record-card:focus-visible {
    transform: translateY(-2px);
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: none;
  }

  .record-card:disabled,
  .withdraw:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .record-visual {
    display: grid;
    place-items: center;
    width: 52px;
    height: 52px;
    overflow: hidden;
    border: 1px solid rgba(236, 228, 207, 0.18);
    background: rgba(0, 0, 0, 0.22);
  }

  .record-visual img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .record-seal,
  .statement-seal {
    color: var(--crimson);
    font-family: var(--display-jp);
    font-size: 28px;
  }

  .statement-seal {
    background: rgba(71, 184, 203, 0.08);
    color: var(--cyan);
  }

  .record-copy {
    display: grid;
    gap: 4px;
    min-width: 0;
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.45;
    color: var(--bone-dim);
  }

  .record-kind {
    color: var(--bone-faint);
  }

  .record-copy strong {
    color: var(--bone);
    font-size: 16px;
    font-weight: 500;
  }

  .record-copy small {
    color: var(--bone-faint);
    font-size: 12px;
  }

  footer {
    align-items: center;
    padding-top: 4px;
    border-top: 1px solid rgba(236, 228, 207, 0.1);
  }

  footer p {
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-size: 12px;
  }

  .withdraw {
    flex: 0 0 auto;
    min-width: 92px;
    min-height: 38px;
    border: 1px solid var(--rule-strong);
    background: transparent;
    color: var(--bone);
    font: inherit;
    font-family: var(--serif-jp);
    cursor: pointer;
  }

  .withdraw:hover:not(:disabled),
  .withdraw:focus-visible {
    border-color: var(--cyan);
    background: rgba(71, 184, 203, 0.1);
    outline: none;
  }

  @media (max-width: 720px) {
    .interrogation-tray-scrim {
      align-items: end;
      padding: 18px;
    }

    .interrogation-evidence-tray {
      width: min(760px, calc(100vw - 36px));
      max-height: min(760px, calc(100dvh - 36px));
      padding: 20px;
    }

    .record-list {
      grid-template-columns: 1fr;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .record-card {
      transition: none;
    }
  }
</style>
