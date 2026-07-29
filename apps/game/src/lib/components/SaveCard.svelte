<script lang="ts">
  import { readSaveThumbnail } from "$lib/persistence/commands";
  import type { SaveBrowserMode } from "$lib/persistence/save-browser-controller.svelte";
  import type { SaveSlotView } from "$lib/persistence/types";

  let {
    slot,
    mode,
    isContinueCandidate = false,
    selected = false,
    interactive = true,
    onSelect = () => {},
    onLoad = () => {},
    onDelete = () => {},
    readThumbnail = readSaveThumbnail,
  }: {
    slot: SaveSlotView;
    mode: SaveBrowserMode;
    isContinueCandidate?: boolean;
    selected?: boolean;
    interactive?: boolean;
    onSelect?: (slot: SaveSlotView, opener: HTMLElement) => void;
    onLoad?: (slot: SaveSlotView, opener: HTMLElement) => void;
    onDelete?: (slot: SaveSlotView, opener: HTMLElement) => void;
    readThumbnail?: typeof readSaveThumbnail;
  } = $props();

  let thumbnailUrl = $state<string | null>(null);
  let thumbnailUnavailable = $state(false);
  const thumbnailOwnership: { revoke: (() => void) | null } = {
    revoke: null,
  };

  const metadata = $derived(
    slot.status.type === "valid"
      ? slot.status.metadata
      : slot.status.type === "invalid"
        ? slot.status.metadata
        : null,
  );
  const summary = $derived(metadata?.summary ?? null);
  const displayName = $derived(metadata?.displayName ?? null);
  const isValid = $derived(slot.status.type === "valid");
  const isEmpty = $derived(slot.status.type === "empty");
  const slotLabel = $derived(
    `${slot.reference.type === "auto" ? "自動存檔" : "手動存檔"} ${slot.reference.slot}`,
  );

  $effect(() => {
    const reference = slot.reference;
    const observedSaveId = metadata?.saveId ?? null;
    const availability = metadata?.thumbnail ?? null;
    let active = true;
    let ownedUrl: string | null = null;
    const revokeOwnedUrl = () => {
      if (!ownedUrl) return;
      const url = ownedUrl;
      ownedUrl = null;
      URL.revokeObjectURL(url);
      if (thumbnailUrl === url) thumbnailUrl = null;
    };
    thumbnailOwnership.revoke = revokeOwnedUrl;

    thumbnailUrl = null;
    thumbnailUnavailable =
      availability !== null && availability.type === "unavailable";

    if (
      availability?.type === "available" &&
      typeof observedSaveId === "string"
    ) {
      void readThumbnail(reference, observedSaveId)
        .then((bytes) => {
          if (!active) return;
          ownedUrl = URL.createObjectURL(
            new Blob([bytes as BlobPart], { type: "image/png" }),
          );
          if (!active) {
            revokeOwnedUrl();
            return;
          }
          thumbnailUrl = ownedUrl;
          thumbnailUnavailable = false;
        })
        .catch(() => {
          if (active) thumbnailUnavailable = true;
        });
    }

    return () => {
      active = false;
      if (thumbnailOwnership.revoke === revokeOwnedUrl) {
        thumbnailOwnership.revoke = null;
      }
      revokeOwnedUrl();
    };
  });

  function decodeFailed(): void {
    thumbnailOwnership.revoke?.();
    thumbnailUnavailable = true;
  }

  function localSavedAt(value: string | null | undefined): string | null {
    if (!value) return null;
    const instant = new Date(value);
    if (Number.isNaN(instant.valueOf())) return null;
    return new Intl.DateTimeFormat("zh-Hant", {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(instant);
  }
</script>

<article
  class:selected
  class:invalid={slot.status.type === "invalid"}
  data-slot-type={slot.reference.type}
  data-slot-number={slot.reference.slot}
>
  <header>
    <span class="slot-label">{slotLabel}</span>
    {#if isContinueCandidate}
      <span class="newest">最新</span>
    {/if}
  </header>

  <div
    class="thumbnail-frame letterbox"
    data-testid="thumbnail-frame"
    style:aspect-ratio={metadata?.thumbnail.type === "available"
      ? `${metadata.thumbnail.width} / ${metadata.thumbnail.height}`
      : "16 / 9"}
  >
    {#if thumbnailUrl}
      <img
        src={thumbnailUrl}
        alt={`${displayName ?? slotLabel}的預覽`}
        width={metadata?.thumbnail.type === "available"
          ? metadata.thumbnail.width
          : undefined}
        height={metadata?.thumbnail.type === "available"
          ? metadata.thumbnail.height
          : undefined}
        style="object-fit: contain"
        onerror={decodeFailed}
      />
    {:else if thumbnailUnavailable || slot.status.type === "invalid" || (!isEmpty && metadata)}
      <span class="thumbnail-placeholder">無法顯示預覽</span>
    {:else}
      <span class="thumbnail-placeholder empty-preview" aria-hidden="true"
        >EMPTY</span
      >
    {/if}
  </div>

  <div class="details">
    {#if isEmpty}
      <strong>空白存檔</strong>
    {:else}
      <strong>{displayName ?? "無法讀取存檔名稱"}</strong>
      {#if summary}
        <span>{summary.chapterTitle}</span>
        <span>{summary.sceneTitle}</span>
        <span class="objective"
          >{summary.activePrimaryObjectiveLabel ?? "沒有進行中的主要目標"}</span
        >
      {/if}
      {#if localSavedAt(metadata?.savedAt)}
        <time data-testid="saved-at" datetime={metadata?.savedAt ?? undefined}
          >{localSavedAt(metadata?.savedAt)}</time
        >
      {/if}
      {#if slot.status.type === "invalid"}
        <p class="diagnostic" role="alert">{slot.status.diagnostic.message}</p>
      {/if}
    {/if}
  </div>

  {#if interactive}
    <div class="actions">
      <button
        type="button"
        class="select"
        aria-label={`選擇${slotLabel}`}
        onclick={(event) =>
          onSelect(slot, event.currentTarget as HTMLButtonElement)}
      >
        選擇
      </button>
      {#if mode !== "manualSave"}
        <button
          type="button"
          class="load"
          disabled={!isValid}
          onclick={(event) =>
            onLoad(slot, event.currentTarget as HTMLButtonElement)}
        >
          載入
        </button>
      {/if}
      {#if !isEmpty}
        <button
          type="button"
          class="delete"
          onclick={(event) =>
            onDelete(slot, event.currentTarget as HTMLButtonElement)}
        >
          刪除
        </button>
      {/if}
    </div>
  {/if}
</article>

<style>
  article {
    min-width: 0;
    padding: 12px;
    border: 1px solid var(--rule-strong, #59636b);
    background: color-mix(in srgb, var(--cell, #161b20) 88%, transparent);
    color: var(--bone, #e8e0d1);
  }

  article.selected {
    border-color: var(--cyan, #65d8ea);
  }

  article.invalid {
    border-color: var(--crimson, #d96672);
  }

  header,
  .actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .slot-label,
  .newest {
    font-size: 0.75rem;
    letter-spacing: 0.08em;
  }

  .newest {
    color: var(--cyan, #65d8ea);
  }

  .thumbnail-frame {
    display: grid;
    place-items: center;
    width: 100%;
    margin-block: 10px;
    overflow: hidden;
    background: #080b0e;
  }

  .thumbnail-frame img {
    width: 100%;
    height: 100%;
  }

  .thumbnail-placeholder {
    color: var(--bone-dim, #a7a092);
    font-size: 0.8rem;
  }

  .empty-preview {
    opacity: 0.38;
    letter-spacing: 0.2em;
  }

  .details {
    display: grid;
    gap: 4px;
    min-height: 6rem;
  }

  .details span,
  time {
    color: var(--bone-dim, #a7a092);
    font-size: 0.8rem;
  }

  .objective {
    color: var(--cyan, #65d8ea);
  }

  .diagnostic {
    margin: 4px 0 0;
    color: var(--crimson, #e77c86);
    font-size: 0.8rem;
  }

  .actions {
    justify-content: flex-start;
    margin-top: 10px;
  }

  button {
    min-height: 34px;
    border: 1px solid var(--rule-strong, #59636b);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  button:disabled {
    cursor: not-allowed;
    opacity: 0.4;
  }

  .delete {
    margin-inline-start: auto;
    color: var(--crimson, #e77c86);
  }
</style>
