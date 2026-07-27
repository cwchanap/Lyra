<script lang="ts">
  import { onDestroy } from "svelte";
  import {
    invokePersistenceCommand,
    readSaveThumbnail,
  } from "$lib/persistence/commands";
  import type {
    SaveBrowserOpenResultView,
    SaveSlotView,
  } from "$lib/persistence/types";
  import type { PackagedCaptureProofStatus } from "$lib/persistence/thumbnail-capture";

  let {
    onForceNextCaptureUnavailable,
    captureUnavailableReason = () => "",
    captureStatus = () => ({
      calls: 0,
      available: 0,
      lastClosedReason: "",
      lastRenderDiagnostic: "",
    }),
    captureCommandInFlight = false,
  }: {
    onForceNextCaptureUnavailable: () => void;
    captureUnavailableReason?: () => string;
    captureStatus?: () => PackagedCaptureProofStatus;
    captureCommandInFlight?: boolean;
  } = $props();

  let status = $state<
    "idle" | "loading" | "ready" | "empty" | "unavailable" | "error"
  >("idle");
  let imageUrl = $state<string | null>(null);
  let observedSaveId = $state<string | null>(null);
  let intrinsicWidth = $state(0);
  let intrinsicHeight = $state(0);
  let errorCode = $state("");
  let errorMessage = $state("");
  let errorStage = $state("");
  let unavailableReason = $state("");
  let completedCommandGeneration = $state(0);
  let observedCommandInFlight = false;
  let captureCalls = $state(0);
  let captureAvailable = $state(0);
  let captureLastClosedReason = $state("");
  let captureLastRenderDiagnostic = $state("");
  $effect(() => {
    const inFlight = captureCommandInFlight;
    const snapshot = captureStatus();
    captureCalls = snapshot.calls;
    captureAvailable = snapshot.available;
    captureLastClosedReason = snapshot.lastClosedReason;
    captureLastRenderDiagnostic = snapshot.lastRenderDiagnostic;
    if (inFlight) {
      observedCommandInFlight = true;
    } else if (observedCommandInFlight) {
      observedCommandInFlight = false;
      completedCommandGeneration += 1;
    }
  });

  function commandDiagnostic(error: unknown): {
    code: string;
    message: string;
  } {
    if (typeof error === "object" && error !== null) {
      const record = error as Record<string, unknown>;
      if (
        typeof record.code === "string" &&
        typeof record.message === "string"
      ) {
        return { code: record.code, message: record.message };
      }
    }
    return {
      code: "captureProofCommandFailed",
      message: "Persistence command failed.",
    };
  }

  function newestAutosave(slots: SaveSlotView[]): SaveSlotView | null {
    return (
      slots
        .filter(
          (slot) =>
            slot.reference.type === "auto" && slot.status.type === "valid",
        )
        .sort((left, right) => {
          const leftSavedAt =
            left.status.type === "valid" ? left.status.metadata.savedAt : "";
          const rightSavedAt =
            right.status.type === "valid" ? right.status.metadata.savedAt : "";
          return rightSavedAt.localeCompare(leftSavedAt);
        })[0] ?? null
    );
  }

  function replaceImageUrl(next: string | null): void {
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageUrl = next;
  }

  async function refresh(): Promise<void> {
    status = "loading";
    intrinsicWidth = 0;
    intrinsicHeight = 0;
    errorCode = "";
    errorMessage = "";
    errorStage = "";
    unavailableReason = "";
    let stage = "listSaves";
    try {
      const opened =
        await invokePersistenceCommand<SaveBrowserOpenResultView>("list_saves");
      stage = "selectAutosave";
      const slot = newestAutosave(opened.browser.slots);
      if (!slot || slot.status.type !== "valid") {
        replaceImageUrl(null);
        observedSaveId = null;
        status = "empty";
        return;
      }
      const saveId = slot.status.metadata.saveId;
      if (slot.status.metadata.thumbnail.type !== "available") {
        replaceImageUrl(null);
        observedSaveId = saveId;
        unavailableReason =
          captureUnavailableReason() || slot.status.metadata.thumbnail.reason;
        status = "unavailable";
        return;
      }
      stage = "readThumbnail";
      const bytes = await readSaveThumbnail(slot.reference, saveId);
      stage = "buildBlobUrl";
      const buffer = new ArrayBuffer(bytes.byteLength);
      new Uint8Array(buffer).set(bytes);
      const blob = new Blob([buffer], { type: "image/png" });
      replaceImageUrl(URL.createObjectURL(blob));
      observedSaveId = saveId;
      status = "ready";
    } catch (error) {
      const diagnostic = commandDiagnostic(error);
      replaceImageUrl(null);
      observedSaveId = null;
      errorCode = diagnostic.code;
      errorMessage = diagnostic.message;
      errorStage = stage;
      status = "error";
    }
  }

  function handleImageLoad(event: Event): void {
    const image = event.currentTarget;
    if (!(image instanceof HTMLImageElement)) return;
    intrinsicWidth = image.naturalWidth;
    intrinsicHeight = image.naturalHeight;
  }

  onDestroy(() => {
    replaceImageUrl(null);
  });
</script>

<aside
  data-hpa-392-capture-proof=""
  data-hpa-392-capture-proof-status={status}
  data-hpa-392-capture-proof-save-id={observedSaveId ?? ""}
  data-hpa-392-capture-proof-width={intrinsicWidth}
  data-hpa-392-capture-proof-height={intrinsicHeight}
  data-hpa-392-capture-proof-error-code={errorCode}
  data-hpa-392-capture-proof-error-message={errorMessage}
  data-hpa-392-capture-proof-error-stage={errorStage}
  data-hpa-392-capture-proof-unavailable-reason={unavailableReason}
  data-hpa-392-capture-proof-command-status={captureCommandInFlight
    ? "capturing"
    : "idle"}
  data-hpa-392-capture-proof-completed-generation={completedCommandGeneration}
  data-hpa-392-capture-proof-calls={captureCalls}
  data-hpa-392-capture-proof-available={captureAvailable}
  data-hpa-392-capture-proof-last-closed-reason={captureLastClosedReason}
  data-hpa-392-capture-proof-last-render-diagnostic={captureLastRenderDiagnostic}
  data-save-thumbnail-exclude=""
  aria-label="Packaged capture proof"
>
  <button type="button" data-hpa-392-capture-proof-refresh="" onclick={refresh}>
    Refresh capture proof
  </button>
  <button
    type="button"
    data-hpa-392-capture-proof-force-unavailable=""
    onclick={onForceNextCaptureUnavailable}
  >
    Force next capture unavailable
  </button>
  {#if imageUrl}
    <img
      data-hpa-392-capture-proof-thumbnail=""
      src={imageUrl}
      alt="Newest autosave capture proof"
      onload={handleImageLoad}
    />
  {/if}
</aside>

<style>
  aside {
    position: fixed;
    right: 8px;
    bottom: 8px;
    z-index: 1000;
    display: grid;
    gap: 4px;
    max-width: min(40vw, 500px);
    padding: 8px;
    background: #111;
  }

  img {
    display: block;
    max-width: 100%;
    height: auto;
  }
</style>
