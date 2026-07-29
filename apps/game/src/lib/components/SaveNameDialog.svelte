<script lang="ts">
  import { onMount, tick } from "svelte";
  import {
    suggestManualDisplayName,
    validateManualDisplayName,
  } from "$lib/persistence/manual-name";
  import type {
    ManualSlotExpectationView,
    SaveSlotView,
    SaveSummaryView,
  } from "$lib/persistence/types";

  export type SaveNameSubmission = {
    displayName: string;
    expectation: ManualSlotExpectationView;
  };

  let {
    slot,
    currentSummary,
    returnFocusTo = null,
    pending = false,
    onSubmit,
    onCancel,
  }: {
    slot: SaveSlotView;
    currentSummary: SaveSummaryView;
    returnFocusTo?: HTMLElement | null;
    pending?: boolean;
    onSubmit: (submission: SaveNameSubmission, opener: HTMLElement) => void;
    onCancel: () => void;
  } = $props();

  let dialog = $state<HTMLDivElement | null>(null);
  let input = $state<HTMLInputElement | null>(null);
  let editedName = $state<string | null>(null);
  let validationAttempted = $state(false);
  let mounted = false;
  let pendingObserved = false;
  let previousPending = false;

  const readableExistingName = $derived(
    slot.status.type === "valid"
      ? slot.status.metadata.displayName
      : slot.status.type === "invalid"
        ? slot.status.metadata?.displayName
        : null,
  );
  const suggestedName = $derived(
    suggestManualDisplayName(
      currentSummary.chapterTitle,
      currentSummary.sceneTitle,
    ),
  );
  const displayName = $derived(
    editedName ?? readableExistingName ?? suggestedName,
  );
  const validation = $derived(validateManualDisplayName(displayName));
  const validationMessage = $derived(
    validation.ok
      ? null
      : validation.reason === "empty"
        ? "請輸入存檔名稱。"
        : validation.reason === "tooLong"
          ? "存檔名稱不可超過 40 個字元。"
          : "存檔名稱包含不允許的字元。",
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

  function expectation(): ManualSlotExpectationView {
    if (slot.status.type === "empty") return { type: "empty" };
    const saveId =
      slot.status.type === "valid"
        ? slot.status.metadata.saveId
        : (slot.status.metadata?.saveId ?? null);
    return {
      type: "occupied",
      observation: { saveId, modifiedAt: slot.modifiedAt },
    };
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

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (pending) return;
    validationAttempted = true;
    if (!validation.ok) {
      input?.focus();
      return;
    }
    onSubmit(
      { displayName, expectation: expectation() },
      event.submitter instanceof HTMLElement
        ? event.submitter
        : (input ?? dialog ?? document.body),
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
        'input:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
    if (pending) dialog?.focus();
    else input?.focus();
  });
</script>

<div class="backdrop" role="presentation" onkeydown={keydown}>
  <div
    bind:this={dialog}
    class="dialog"
    role="dialog"
    tabindex="-1"
    aria-modal="true"
    aria-labelledby="save-name-title"
  >
    <h2 id="save-name-title">命名存檔</h2>
    <p class="current-location">
      <span>{currentSummary.chapterTitle}</span>
      <span aria-hidden="true">／</span>
      <span>{currentSummary.sceneTitle}</span>
    </p>

    <form aria-label="存檔命名" onsubmit={submit}>
      <label for="manual-save-name">存檔名稱</label>
      <input
        bind:this={input}
        id="manual-save-name"
        value={displayName}
        aria-invalid={validationAttempted && !validation.ok}
        aria-describedby={validationAttempted && !validation.ok
          ? "save-name-error"
          : undefined}
        disabled={pending}
        oninput={(event) => {
          editedName = event.currentTarget.value;
          validationAttempted = false;
        }}
      />
      {#if validationAttempted && validationMessage}
        <p id="save-name-error" class="error" role="alert">
          {validationMessage}
        </p>
      {/if}
      <div class="actions">
        <button type="button" disabled={pending} onclick={cancel}>取消</button>
        <button type="submit" disabled={pending}>繼續</button>
      </div>
    </form>
  </div>
</div>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: grid;
    place-items: center;
    padding: 20px;
    background: rgb(0 0 0 / 72%);
  }

  .dialog {
    box-sizing: border-box;
    width: min(520px, 100%);
    padding: 22px;
    border: 1px solid var(--rule-strong, #59636b);
    background: var(--void, #080b0e);
    color: var(--bone, #e8e0d1);
  }

  h2,
  p {
    margin: 0;
  }

  .current-location {
    display: flex;
    gap: 6px;
    margin-block: 8px 18px;
    color: var(--bone-dim, #a7a092);
  }

  form,
  label {
    display: grid;
    gap: 8px;
  }

  input {
    min-height: 42px;
    padding-inline: 10px;
    border: 1px solid var(--rule-strong, #59636b);
    background: var(--cell, #161b20);
    color: inherit;
    font: inherit;
  }

  input[aria-invalid="true"] {
    border-color: var(--crimson, #e77c86);
  }

  .error {
    color: var(--crimson, #e77c86);
    font-size: 0.85rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 14px;
  }

  button {
    min-height: 38px;
    padding-inline: 14px;
    border: 1px solid var(--rule-strong, #59636b);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
</style>
