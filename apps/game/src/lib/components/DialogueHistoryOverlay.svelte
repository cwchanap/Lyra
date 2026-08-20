<script lang="ts">
  import { onDestroy, onMount } from "svelte";
  import { claimEscape } from "$lib/state/escape-coordinator";
  import DialogueHistoryPanel from "./DialogueHistoryPanel.svelte";
  import type { DialogueHistoryEntry } from "../state/types";

  type DialogueHistoryOverlayProps = {
    history: DialogueHistoryEntry[];
    bottom: number;
    onClose: () => void;
    showCloseShortcutHint?: boolean;
  };

  let {
    history,
    bottom,
    onClose,
    showCloseShortcutHint = true,
  }: DialogueHistoryOverlayProps = $props();
  let releaseEscapeClaim: (() => void) | null = null;

  function close(): void {
    // Release before the parent flips its local open state, so a second
    // Escape cannot close an underlying layer before Svelte destroys us.
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
    onClose();
  }

  onMount(() => {
    releaseEscapeClaim = claimEscape(close);
  });

  onDestroy(() => {
    releaseEscapeClaim?.();
    releaseEscapeClaim = null;
  });
</script>

<div
  class="history-backdrop"
  aria-hidden="true"
  style="pointer-events: none"
></div>
<DialogueHistoryPanel
  {history}
  {bottom}
  {showCloseShortcutHint}
  onClose={close}
/>

<style>
  .history-backdrop {
    position: fixed;
    inset: 0;
    z-index: 32;
    background: rgba(0, 0, 0, 0.55);
    pointer-events: none;
  }
</style>
