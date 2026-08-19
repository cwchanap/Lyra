<script lang="ts">
  import type { AnalysisCardView } from "$lib/state/types";

  type PointerDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    moved: boolean;
    targetId: string | null;
    captureElement: HTMLElement | null;
  };

  const pointerDragThresholdPx = 4;

  function resolveDropTargetAt(x: number, y: number): string | null {
    /* v8 ignore next -- unreachable: SPA mode guarantees document is defined in Tauri and jsdom */
    if (typeof document === "undefined") return null;

    const elements = document.elementsFromPoint?.(x, y) ?? [];
    for (const element of elements) {
      const target = element.closest<HTMLElement>(
        "[data-analysis-drop-target]",
      );
      if (target?.dataset.analysisDropTarget) {
        return target.dataset.analysisDropTarget;
      }
    }
    return null;
  }

  let {
    card,
    badges = [],
    badge = null,
    selected = false,
    disabled = false,
    readOnly = false,
    unavailableLabel = "尚未取得",
    onSelect,
    focusKey = null,
    dragEnabled = false,
    resolveDropTarget,
    onDragStart,
    onDragTargetChange,
    onDrop,
    onDragCancel,
  }: {
    card: AnalysisCardView;
    badges?: readonly string[];
    badge?: string | null;
    selected?: boolean;
    disabled?: boolean;
    readOnly?: boolean;
    unavailableLabel?: string;
    onSelect?: () => void;
    focusKey?: string | null;
    dragEnabled?: boolean;
    resolveDropTarget?: (x: number, y: number) => string | null;
    onDragStart?: () => void;
    onDragTargetChange?: (targetId: string | null) => void;
    onDrop?: (targetId: string | null) => void;
    onDragCancel?: () => void;
  } = $props();

  let allBadges = $derived(badge ? [badge, ...badges] : [...badges]);
  let interactive = $derived(onSelect !== undefined && !readOnly);
  let unavailable = $derived(!card.available);
  let effectiveFocusKey = $derived(focusKey ?? `card:${card.id}`);

  let dragState: PointerDragState | null = null;
  let suppressNextPhysicalClick = false;

  // No timer: suppression stays armed until the next gesture starts
  // (handlePointerDown) or the suppressed click is consumed
  // (handleSelectClick).
  function clearClickSuppression() {
    suppressNextPhysicalClick = false;
  }

  function armClickSuppression() {
    suppressNextPhysicalClick = true;
  }

  function setPointerCaptureBestEffort(
    element: HTMLElement | null,
    pointerId: number,
  ) {
    try {
      element?.setPointerCapture?.(pointerId);
    } catch {
      // Pointer capture is not available in every test/runtime surface.
    }
  }

  function releasePointerCaptureBestEffort(
    element: HTMLElement | null,
    pointerId: number,
  ) {
    try {
      element?.releasePointerCapture?.(pointerId);
    } catch {
      // Pointer capture is best effort and must not block a completed gesture.
    }
  }

  function handlePointerDown(event: PointerEvent) {
    if (
      !dragEnabled ||
      disabled ||
      readOnly ||
      unavailable ||
      (event.pointerType !== "mouse" && event.pointerType !== "pen") ||
      event.button !== 0
    ) {
      return;
    }

    clearClickSuppression();
    const captureElement =
      /* v8 ignore next -- unreachable: the pointer handler is attached to an HTMLElement, so currentTarget is always an HTMLElement */
      event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
      targetId: null,
      captureElement,
    };
    setPointerCaptureBestEffort(captureElement, event.pointerId);
  }

  function handlePointerMove(event: PointerEvent) {
    const currentDrag = dragState;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

    const deltaX = event.clientX - currentDrag.startX;
    const deltaY = event.clientY - currentDrag.startY;
    const moved =
      currentDrag.moved ||
      Math.abs(deltaX) > pointerDragThresholdPx ||
      Math.abs(deltaY) > pointerDragThresholdPx;
    if (!moved) return;

    let activeDrag = currentDrag;
    if (!currentDrag.moved) {
      event.preventDefault();
      activeDrag = { ...currentDrag, moved: true };
      dragState = activeDrag;
      onDragStart?.();
    }

    const nextTargetId = (resolveDropTarget ?? resolveDropTargetAt)(
      event.clientX,
      event.clientY,
    );
    if (nextTargetId === activeDrag.targetId) return;

    dragState = { ...activeDrag, targetId: nextTargetId };
    onDragTargetChange?.(nextTargetId);
  }

  function handlePointerUp(event: PointerEvent) {
    const currentDrag = dragState;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

    dragState = null;
    releasePointerCaptureBestEffort(
      currentDrag.captureElement,
      currentDrag.pointerId,
    );
    if (!currentDrag.moved) return;

    // Re-hit-test on pointer-up: the workspace is scrollable, so its contents
    // can move under a captured pointer without another pointermove event
    // (e.g. wheel/trackpad scroll while holding the button). Committing the
    // cached targetId from the last pointermove could drop into a group/gutter
    // that is no longer under the pointer.
    const dropTargetId = (resolveDropTarget ?? resolveDropTargetAt)(
      event.clientX,
      event.clientY,
    );
    armClickSuppression();
    onDrop?.(dropTargetId);
  }

  function handlePointerCancel(event: PointerEvent) {
    const currentDrag = dragState;
    if (!currentDrag || currentDrag.pointerId !== event.pointerId) return;

    dragState = null;
    releasePointerCaptureBestEffort(
      currentDrag.captureElement,
      currentDrag.pointerId,
    );
    if (currentDrag.moved) onDragCancel?.();
  }

  function handleSelectClick(event: MouseEvent) {
    if (event.detail > 0 && suppressNextPhysicalClick) {
      clearClickSuppression();
      event.preventDefault();
      return;
    }
    onSelect?.();
  }
</script>

{#if interactive}
  <button
    type="button"
    class="analysis-card"
    data-analysis-card-id={card.id}
    data-analysis-focus-key={effectiveFocusKey}
    class:selected
    class:unavailable
    disabled={disabled || unavailable || readOnly}
    aria-pressed={selected}
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
    onclick={handleSelectClick}
  >
    <span class="sr-only">選取：</span>
    <span class="card-copy">
      <strong>{card.label}</strong>
      <span>{card.summary}</span>
    </span>
    {#if allBadges.length > 0}
      <span class="badges" aria-label="卡片標籤">
        {#each allBadges as cardBadge (cardBadge)}
          <span class="badge">{cardBadge}</span>
        {/each}
      </span>
    {/if}
    {#if unavailable}
      <span class="availability">{unavailableLabel}</span>
    {/if}
  </button>
{:else}
  <article
    class="analysis-card"
    data-analysis-card-id={card.id}
    data-analysis-focus-key={effectiveFocusKey}
    tabindex="-1"
    class:selected
    class:unavailable
    onpointerdown={handlePointerDown}
    onpointermove={handlePointerMove}
    onpointerup={handlePointerUp}
    onpointercancel={handlePointerCancel}
  >
    <span class="card-copy">
      <strong>{card.label}</strong>
      <span>{card.summary}</span>
    </span>
    {#if allBadges.length > 0}
      <span class="badges" aria-label="卡片標籤">
        {#each allBadges as cardBadge (cardBadge)}
          <span class="badge">{cardBadge}</span>
        {/each}
      </span>
    {/if}
    {#if unavailable}
      <span class="availability">{unavailableLabel}</span>
    {:else if readOnly}
      <span class="availability">僅供檢視</span>
    {/if}
  </article>
{/if}

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

  .analysis-card {
    position: relative;
    display: grid;
    gap: 0.55rem;
    width: 100%;
    min-width: 0;
    padding: 0.78rem 0.9rem 0.72rem 1rem;
    color: var(--bone);
    text-align: left;
    background:
      linear-gradient(135deg, var(--crimson-soft), transparent 42%),
      rgba(236, 228, 207, 0.045);
    border: 1px solid var(--rule-strong);
    border-left: 3px solid var(--crimson);
    clip-path: polygon(0 0, calc(100% - 14px) 0, 100% 14px, 100% 100%, 0 100%);
    font-family: var(--body-jp);
    font-size: 0.9rem;
    line-height: 1.4;
    transition:
      transform 0.18s ease,
      background-color 0.18s ease,
      border-color 0.18s ease;
  }

  .analysis-card::after {
    position: absolute;
    top: 0;
    right: 0;
    width: 14px;
    height: 14px;
    background: var(--analysis-blue, var(--cyan-deep));
    clip-path: polygon(100% 0, 100% 100%, 0 0);
    content: "";
    pointer-events: none;
  }

  button.analysis-card {
    cursor: pointer;
  }

  button.analysis-card:hover:not(:disabled),
  button.analysis-card:focus-visible:not(:disabled) {
    transform: translateY(-1px);
    background:
      linear-gradient(135deg, var(--cyan-soft), transparent 42%),
      rgba(236, 228, 207, 0.08);
    border-color: var(--cyan);
  }

  button.analysis-card:focus-visible {
    outline: 2px solid var(--crimson);
    outline-offset: 3px;
  }

  .analysis-card.selected {
    background:
      linear-gradient(135deg, var(--cyan-soft), transparent 58%),
      rgba(52, 216, 255, 0.08);
    border-color: var(--cyan);
    box-shadow: inset 3px 0 var(--crimson);
  }

  .analysis-card.unavailable,
  button.analysis-card:disabled {
    cursor: default;
    opacity: 0.55;
  }

  .analysis-card.unavailable {
    border-left-color: var(--crimson);
  }

  .card-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .card-copy strong {
    color: var(--bone);
    font-family: var(--display-jp);
    font-size: 0.95rem;
    font-weight: 400;
    letter-spacing: 0.04em;
  }

  .card-copy span {
    overflow-wrap: anywhere;
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 0.76rem;
    line-height: 1.45;
  }

  .badges {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }

  .badge {
    padding: 0.12rem 0.38rem;
    color: var(--cyan);
    background: var(--cyan-soft);
    border: 1px solid var(--cyan-deep);
    font-family: var(--impact);
    font-size: 0.62rem;
    letter-spacing: 0.1em;
  }

  .availability {
    color: var(--crimson);
    font-family: var(--impact);
    font-size: 0.64rem;
    letter-spacing: 0.1em;
  }

  @media (max-width: 720px) {
    .analysis-card {
      gap: 0.45rem;
      padding: 0.68rem 0.78rem 0.62rem 0.88rem;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .analysis-card {
      transition: none;
    }
  }
</style>
