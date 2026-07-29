<script lang="ts">
  import { onMount, tick } from "svelte";
  import SaveCard from "./SaveCard.svelte";
  import type {
    OccupiedSlotExpectationView,
    SaveSlotView,
    SaveSummaryView,
  } from "$lib/persistence/types";

  export type SaveConfirmationRequest =
    | {
        type: "overwrite" | "delete";
        expectation: OccupiedSlotExpectationView;
      }
    | { type: "load"; observedSaveId: string };

  let {
    kind,
    slot,
    currentSummary = null,
    pendingDisplayName = null,
    returnFocusTo = null,
    pending = false,
    onConfirm,
    onCancel,
  }: {
    kind: "overwrite" | "delete" | "load";
    slot: SaveSlotView;
    currentSummary?: SaveSummaryView | null;
    pendingDisplayName?: string | null;
    returnFocusTo?: HTMLElement | null;
    pending?: boolean;
    onConfirm: (request: SaveConfirmationRequest, opener: HTMLElement) => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDivElement | null>(null);
  let cancelButton = $state<HTMLButtonElement | null>(null);
  let confirmButton = $state<HTMLButtonElement | null>(null);
  let mounted = false;
  let pendingObserved = false;
  let previousPending = false;

  const slotLabel = $derived(
    `${slot.reference.type === "auto" ? "自動存檔" : "手動存檔"} ${slot.reference.slot}`,
  );
  const title = $derived(
    kind === "overwrite"
      ? `覆寫${slotLabel}`
      : kind === "delete"
        ? `刪除${slotLabel}`
        : `載入${slotLabel}`,
  );
  const confirmLabel = $derived(
    kind === "overwrite"
      ? "確認覆寫"
      : kind === "delete"
        ? "確認刪除"
        : "確認載入",
  );
  const loadSaveId = $derived(
    slot.status.type === "valid" ? slot.status.metadata.saveId : null,
  );

  $effect(() => {
    const nextPending = pending;
    const shouldMoveFocus =
      mounted && pendingObserved && !previousPending && nextPending;
    pendingObserved = true;
    previousPending = nextPending;
    if (shouldMoveFocus) {
      void tick().then(() => {
        if (pending && dialog?.isConnected) dialog.focus();
      });
    }
  });

  function occupiedExpectation(): OccupiedSlotExpectationView {
    const saveId =
      slot.status.type === "valid"
        ? slot.status.metadata.saveId
        : slot.status.type === "invalid"
          ? (slot.status.metadata?.saveId ?? null)
          : null;
    return { saveId, modifiedAt: slot.modifiedAt };
  }

  function restoreFocus(): void {
    queueMicrotask(() => {
      if (returnFocusTo?.isConnected) returnFocusTo.focus();
    });
  }

  function cancel(): void {
    if (pending) return;
    onCancel();
    restoreFocus();
  }

  function confirm(event: MouseEvent): void {
    if (pending) return;
    if (kind === "load") {
      if (!loadSaveId) return;
      onConfirm(
        { type: "load", observedSaveId: loadSaveId },
        event.currentTarget as HTMLElement,
      );
      return;
    }
    onConfirm(
      { type: kind, expectation: occupiedExpectation() },
      event.currentTarget as HTMLElement,
    );
  }

  function keydown(event: KeyboardEvent): void {
    if (event.key === "Escape" && !event.repeat) {
      event.preventDefault();
      event.stopPropagation();
      if (pending) return;
      cancel();
      return;
    }
    if (event.key !== "Tab" || !dialog) return;
    const controls = Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = controls[0];
    const last = controls.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }

  onMount(() => {
    mounted = true;
    if (pending) {
      dialog?.focus();
      return;
    }
    const initialAction =
      confirmButton && !confirmButton.disabled ? confirmButton : cancelButton;
    initialAction?.focus();
  });
</script>

<div class="backdrop" role="presentation" onkeydown={keydown}>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="save-confirmation-title"
  >
    <h2 id="save-confirmation-title">{title}</h2>
    {#if kind === "load"}
      <p class="warning">目前未儲存的進度將先嘗試儲存。</p>
    {:else if kind === "delete"}
      <p class="warning">刪除後將無法復原這個存檔。</p>
    {:else}
      <p class="warning">這個位置已有存檔。確認後將以目前進度取代。</p>
    {/if}

    <div class:comparison={kind === "overwrite"} class="content">
      <section aria-label="現有存檔">
        <h3>{kind === "overwrite" ? "現有存檔" : "選取的存檔"}</h3>
        <SaveCard {slot} mode="manualSave" interactive={false} />
      </section>

      {#if kind === "overwrite" && currentSummary}
        <section class="current" aria-label="目前遊戲">
          <h3>目前遊戲</h3>
          {#if pendingDisplayName}
            <strong>{pendingDisplayName}</strong>
          {/if}
          <span>{currentSummary.chapterTitle}</span>
          <span>{currentSummary.sceneTitle}</span>
          <span
            >{currentSummary.activePrimaryObjectiveLabel ??
              "沒有進行中的主要目標"}</span
          >
        </section>
      {/if}
    </div>

    <div class="actions">
      <button
        bind:this={cancelButton}
        type="button"
        disabled={pending}
        onclick={cancel}>取消</button
      >
      <button
        bind:this={confirmButton}
        type="button"
        class:danger={kind === "delete"}
        disabled={pending || (kind === "load" && !loadSaveId)}
        onclick={confirm}
      >
        {confirmLabel}
      </button>
    </div>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 110;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(0 0 0 / 76%);
  }

  .dialog {
    box-sizing: border-box;
    width: min(880px, 100%);
    max-height: 90vh;
    padding: 22px;
    overflow: auto;
    border: 1px solid var(--rule-strong, #59636b);
    background: var(--void, #080b0e);
    color: var(--bone, #e8e0d1);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .warning {
    margin-block: 8px 18px;
    color: var(--bone-dim, #a7a092);
  }

  .content {
    display: grid;
    gap: 14px;
  }

  .comparison {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  section {
    display: grid;
    gap: 8px;
    min-width: 0;
  }

  .current {
    align-content: start;
    padding: 14px;
    border: 1px solid var(--cyan, #65d8ea);
    background: color-mix(in srgb, var(--cell, #161b20) 88%, transparent);
  }

  .current span {
    color: var(--bone-dim, #a7a092);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 18px;
  }

  button {
    min-height: 38px;
    padding-inline: 14px;
    border: 1px solid var(--rule-strong, #59636b);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button.danger {
    border-color: var(--crimson, #e77c86);
    color: var(--crimson, #e77c86);
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  @media (max-width: 640px) {
    .comparison {
      grid-template-columns: 1fr;
    }
  }
</style>
