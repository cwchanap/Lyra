<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import {
    interrogationLineText,
    presentableRecords,
    type PresentableRecord,
  } from "$lib/interrogation/presentation";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import type { CrossExamView, Inventory } from "../state/types";

  let {
    crossExam,
    inventory,
    onPresent,
    onResume,
    onOpenGameMenu,
    disabled = false,
    topLayerOpen = false,
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
    onOpenGameMenu: (trigger: HTMLElement) => void;
    disabled?: boolean;
    // True while an upper layer (Game Menu, Save Browser, acquisition popup)
    // is open above this tray. The tray stays mounted (the engine's
    // presenting state is preserved), but its window-level Tab trap must
    // suspend so the upper dialog owns Tab navigation. Without this, the
    // capture-phase window listener intercepts Tab before the upper dialog
    // can process it (stopImmediatePropagation kills the event).
    topLayerOpen?: boolean;
    returnFocusTo?: HTMLElement | null;
    fallbackFocusTarget?: HTMLElement | null;
  } = $props();

  type PresentableRecordKey = `${PresentableRecord["kind"]}:${string}`;

  function presentableRecordKey(
    record: PresentableRecord,
  ): PresentableRecordKey {
    return `${record.kind}:${record.id}`;
  }

  let tray: HTMLDivElement | undefined = $state();
  let evidenceImages = $state<Record<string, ResolvedStoryAsset | null>>({});
  let records = $derived(presentableRecords(inventory));
  let hoveredRecordKey = $state<PresentableRecordKey | null>(null);
  let focusedRecordKey = $state<PresentableRecordKey | null>(null);
  let inspectedRecordKey = $state<PresentableRecordKey | null>(null);
  let activeRecord = $derived.by(() => {
    const activeRecordKey =
      hoveredRecordKey ?? focusedRecordKey ?? inspectedRecordKey;
    return (
      records.find(
        (record) => presentableRecordKey(record) === activeRecordKey,
      ) ?? null
    );
  });
  let focusTarget: HTMLElement | null = null;
  let fallbackTarget: HTMLElement | null = null;
  let releaseEscapeClaim: (() => void) | null = null;

  $effect(() => {
    let cancelled = false;
    evidenceImages = {};

    for (const record of records) {
      if (record.kind !== "evidence" || !record.imageAssetId) continue;
      const assetId = record.imageAssetId;

      resolveStoryAsset(assetId, "evidence")
        .then((asset) => {
          if (!cancelled && asset) {
            evidenceImages[record.id] = asset;
          }
        })
        .catch(() => {
          if (!cancelled) {
            evidenceImages[record.id] = placeholderForMissingStoryAsset(
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

  function showHoveredRecordDetail(record: PresentableRecord): void {
    const key = presentableRecordKey(record);
    hoveredRecordKey = key;
    inspectedRecordKey = key;
  }

  function clearHoveredRecordDetail(record: PresentableRecord): void {
    const key = presentableRecordKey(record);
    if (hoveredRecordKey === key) hoveredRecordKey = null;
  }

  function showFocusedRecordDetail(record: PresentableRecord): void {
    const key = presentableRecordKey(record);
    hoveredRecordKey = null;
    focusedRecordKey = key;
    inspectedRecordKey = key;
  }

  function clearFocusedRecordDetail(record: PresentableRecord): void {
    const key = presentableRecordKey(record);
    if (focusedRecordKey === key) focusedRecordKey = null;
  }

  function present(kind: "evidence" | "statement", itemId: string) {
    if (disabled) return;
    void onPresent(crossExam.lineId, kind, itemId);
  }

  function resume() {
    if (disabled) return;
    void onResume();
  }

  function openGameMenu(event: MouseEvent) {
    if (disabled) return;
    const trigger = event.currentTarget;
    if (trigger instanceof HTMLElement) {
      onOpenGameMenu(trigger);
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key !== "Tab" || !tray) return;
    // Suspend the trap while an upper layer (Game Menu / Save Browser /
    // acquisition popup) is open above this tray. The tray remains mounted
    // but must not intercept Tab — the upper dialog owns keyboard navigation
    // while it is the topmost modal. stopImmediatePropagation below would
    // otherwise kill the event before the upper dialog's handler runs.
    if (topLayerOpen) return;
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

<div class="interrogation-tray-scrim" data-save-thumbnail-exclude="">
  <div
    bind:this={tray}
    class="interrogation-evidence-tray"
    data-interrogation-present-tray=""
    role="dialog"
    aria-modal="true"
    aria-labelledby="interrogation-evidence-heading"
    aria-describedby="interrogation-evidence-line"
    tabindex="-1"
  >
    <header>
      <div class="header-copy">
        <p class="eyebrow">PRESENT / 提出證據</p>
        <h2 id="interrogation-evidence-heading">提出證據</h2>
      </div>
      <p class="progress">
        證詞 {crossExam.lineIndex + 1} / {crossExam.lineTotal}
      </p>
      <button
        type="button"
        class="tray-escape"
        data-interrogation-tray-escape=""
        {disabled}
        onclick={resume}
      >
        ESC
      </button>
    </header>

    <blockquote id="interrogation-evidence-line" class="line-record">
      <span class="target-kicker">鎖定證詞 · TARGET LINE</span>
      <span class="target-text"
        >{interrogationLineText(crossExam.lineContent)}</span
      >
    </blockquote>

    <section
      class="record-grid"
      data-interrogation-evidence-grid=""
      aria-label="可提出的紀錄"
    >
      {#each records as record (record.kind + ":" + record.id)}
        <button
          class:statement-card={record.kind === "statement"}
          class:evidence-card={record.kind === "evidence"}
          class:inspected-record={presentableRecordKey(record) ===
            inspectedRecordKey}
          class="record-tile"
          type="button"
          {disabled}
          onmouseenter={() => showHoveredRecordDetail(record)}
          onmouseleave={() => clearHoveredRecordDetail(record)}
          onfocus={() => showFocusedRecordDetail(record)}
          onblur={() => clearFocusedRecordDetail(record)}
          onclick={() => present(record.kind, record.id)}
        >
          <span class="record-visual" aria-hidden="true">
            {#if record.kind === "evidence" && evidenceImages[record.id]}
              <img
                src={evidenceImages[record.id]?.url}
                alt=""
                onerror={() => handleEvidenceImageError(record.id)}
              />
            {:else if record.kind === "evidence"}
              <span class="record-seal">證</span>
            {:else}
              <span class="record-seal statement-seal">言</span>
            {/if}
          </span>
          <span class="record-copy">
            <strong>{record.shortName}</strong>
            <span class="record-source">{record.sourceTag}</span>
          </span>
        </button>
      {/each}
    </section>

    <section
      class="record-detail"
      data-interrogation-evidence-detail=""
      aria-live="polite"
      aria-label="紀錄詳情"
    >
      {#if activeRecord}
        <div class="record-detail-copy">
          <p class="record-detail-meta">
            {activeRecord.typeLabel} · {activeRecord.sourceTag}
          </p>
          <h3>{activeRecord.shortName}</h3>
          <p>{activeRecord.description}</p>
          {#if activeRecord.details}<p>{activeRecord.details}</p>{/if}
        </div>
      {:else}
        <p>將游標移至紀錄，或以 Tab 選取以查看詳情。</p>
      {/if}
    </section>

    <footer>
      <p>選擇一項紀錄以反駁目前證詞。</p>
      <div class="footer-actions">
        <button
          class="game-menu"
          data-interrogation-game-menu=""
          type="button"
          {disabled}
          onclick={openGameMenu}
        >
          遊戲選單
        </button>
        <button class="withdraw" type="button" {disabled} onclick={resume}>
          收回
        </button>
      </div>
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
    grid-template-rows: auto auto minmax(0, 1fr) auto auto;
    gap: 18px;
    width: min(900px, calc(100vw - 48px));
    max-height: min(760px, calc(100dvh - 48px));
    padding: clamp(20px, 3vw, 32px);
    overflow: hidden;
    border: 1px solid rgba(236, 228, 207, 0.32);
    border-top: 3px solid var(--crimson);
    background: linear-gradient(
      180deg,
      rgba(16, 16, 25, 0.98),
      rgba(20, 14, 24, 0.98)
    );
    box-shadow: 0 40px 90px rgba(0, 0, 0, 0.7);
    clip-path: polygon(
      0 0,
      100% 0,
      100% calc(100% - 26px),
      calc(100% - 26px) 100%,
      0 100%
    );
  }

  header,
  footer {
    display: flex;
    justify-content: space-between;
    gap: 16px;
  }

  header {
    align-items: baseline;
  }

  .header-copy {
    display: flex;
    align-items: baseline;
    gap: 14px;
    min-width: 0;
  }

  .eyebrow,
  h2,
  .progress,
  .line-record,
  footer p {
    margin: 0;
  }

  .eyebrow,
  .progress {
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
  }

  .eyebrow {
    color: var(--bone-faint);
    letter-spacing: 0.32em;
  }

  h2 {
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: 19px;
    font-weight: 400;
    letter-spacing: 0.16em;
    line-height: 1.1;
  }

  .progress {
    color: var(--cyan);
    text-align: right;
  }

  .tray-escape {
    flex: 0 0 auto;
    min-width: 62px;
    min-height: 32px;
    padding: 7px 12px 6px;
    border: 1px solid rgba(236, 228, 207, 0.2);
    background: transparent;
    color: var(--bone-dim);
    cursor: pointer;
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.22em;
  }

  .tray-escape:hover:not(:disabled),
  .tray-escape:focus-visible {
    border-color: var(--crimson);
    color: var(--bone);
    outline: none;
  }

  .line-record {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 15px 18px;
    border: 1px solid rgba(212, 20, 58, 0.4);
    border-left: 3px solid var(--crimson);
    background: rgba(212, 20, 58, 0.08);
    color: var(--bone);
  }

  .target-kicker {
    color: var(--crimson);
    font-family: var(--impact);
    font-size: 9px;
    letter-spacing: 0.32em;
  }

  .target-text {
    font-family: var(--serif-jp);
    font-size: clamp(16px, 2vw, 20px);
    font-style: italic;
    line-height: 1.8;
  }

  .record-grid {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 12px;
    min-height: 0;
    overflow-y: auto;
    padding-right: 4px;
  }

  .record-tile {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
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

  .record-tile:hover:not(:disabled),
  .record-tile:focus-visible {
    transform: translateY(-2px);
    border-color: var(--crimson);
    background: var(--crimson-soft);
    outline: none;
  }

  .record-tile.inspected-record:not(:hover):not(:focus-visible) {
    border-color: rgba(212, 20, 58, 0.58);
    background: rgba(212, 20, 58, 0.08);
  }

  .record-tile:disabled,
  .tray-escape:disabled,
  .game-menu:disabled,
  .withdraw:disabled {
    cursor: wait;
    opacity: 0.55;
  }

  .record-visual {
    display: grid;
    place-items: center;
    width: 100%;
    height: 106px;
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

  .record-copy strong {
    color: var(--bone);
    font-size: 16px;
    font-weight: 500;
  }

  .record-source {
    color: var(--bone-faint);
    font-size: 12px;
  }

  .record-detail {
    box-sizing: border-box;
    min-height: 96px;
    padding: 14px 18px;
    overflow-y: auto;
    border: 1px solid rgba(236, 228, 207, 0.16);
    border-left: 2px solid rgba(236, 228, 207, 0.16);
    background: rgba(9, 9, 15, 0.72);
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 13px;
    line-height: 1.7;
  }

  .record-detail > p,
  .record-detail-copy p,
  .record-detail-copy h3 {
    margin: 0;
  }

  .record-detail-copy {
    display: grid;
    gap: 6px;
  }

  .record-detail-meta {
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 9px;
    letter-spacing: 0.2em;
    text-transform: uppercase;
  }

  .record-detail-copy h3 {
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: 15px;
    font-weight: 400;
    letter-spacing: 0.1em;
    line-height: 1.4;
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

  .footer-actions {
    display: flex;
    flex: 0 0 auto;
    gap: 8px;
  }

  .game-menu,
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

  .game-menu {
    color: var(--bone-dim);
  }

  .game-menu:hover:not(:disabled),
  .game-menu:focus-visible {
    border-color: var(--cyan);
    background: rgba(71, 184, 203, 0.1);
    outline: none;
  }

  .withdraw {
    border-color: rgba(236, 228, 207, 0.24);
    color: var(--bone-dim);
  }

  .withdraw:hover:not(:disabled),
  .withdraw:focus-visible {
    border-color: var(--crimson);
    background: transparent;
    color: var(--bone);
    outline: none;
  }

  @media (max-width: 720px) {
    .interrogation-tray-scrim {
      align-items: end;
      padding: 18px;
    }

    .interrogation-evidence-tray {
      width: min(900px, calc(100vw - 36px));
      max-height: min(760px, calc(100dvh - 36px));
      padding: 20px;
    }

    .record-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    footer {
      align-items: flex-start;
      flex-direction: column;
    }

    .footer-actions {
      width: 100%;
    }

    .game-menu,
    .withdraw {
      flex: 1 1 0;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .record-tile {
      transition: none;
    }
  }
</style>
