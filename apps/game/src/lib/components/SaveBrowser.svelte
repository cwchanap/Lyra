<script lang="ts">
  import SaveCard from "./SaveCard.svelte";
  import type { SaveBrowserMode } from "$lib/persistence/save-browser-controller.svelte";
  import type {
    SaveBrowserView,
    SaveSlotRef,
    SaveSlotView,
  } from "$lib/persistence/types";

  let {
    view,
    mode,
    continueCandidate,
    selected = null,
    onSelect = () => {},
    onLoad = () => {},
    onDelete = () => {},
    onRetry = () => {},
    onBack = () => {},
  }: {
    view: SaveBrowserView;
    mode: SaveBrowserMode;
    continueCandidate: SaveSlotRef | null;
    selected?: SaveSlotRef | null;
    onSelect?: (slot: SaveSlotView, opener: HTMLElement) => void;
    onLoad?: (slot: SaveSlotView, opener: HTMLElement) => void;
    onDelete?: (slot: SaveSlotView, opener: HTMLElement) => void;
    onRetry?: () => void;
    onBack?: () => void;
  } = $props();

  const autosaves = $derived(
    view.slots
      .filter((slot) => slot.reference.type === "auto")
      .toSorted((left, right) => left.reference.slot - right.reference.slot),
  );
  const manualSaves = $derived(
    view.slots
      .filter((slot) => slot.reference.type === "manual")
      .toSorted((left, right) => left.reference.slot - right.reference.slot),
  );

  function referencesMatch(
    left: SaveSlotRef | null,
    right: SaveSlotRef,
  ): boolean {
    return left?.type === right.type && left.slot === right.slot;
  }

  function select(slot: SaveSlotView, opener: HTMLElement): void {
    onSelect(slot, opener);
    if (mode === "titleLoad" && slot.status.type === "valid") {
      onLoad(slot, opener);
    }
  }
</script>

<section class="save-browser" aria-label="存檔瀏覽器">
  <header>
    <div>
      <span class="eyebrow">SAVE ARCHIVE</span>
      <h2>{mode === "manualSave" ? "儲存遊戲" : "載入遊戲"}</h2>
    </div>
    <button type="button" class="back" onclick={onBack}>返回</button>
  </header>

  {#if view.discovery.type === "loading"}
    <p class="global-state" role="status">讀取存檔中…</p>
  {:else if view.discovery.type === "unavailable"}
    <div class="global-state unavailable">
      <p role="alert">{view.discovery.diagnostic.message}</p>
      <button type="button" onclick={onRetry}>重試</button>
    </div>
  {:else}
    {#if mode !== "manualSave"}
      <section class="slot-group" role="group" aria-label="自動存檔">
        <div class="group-heading">
          <h3>自動存檔</h3>
          <p>自動存檔已滿時，將自動取代最舊的存檔。</p>
        </div>
        <div class="slot-grid">
          {#each autosaves as slot (`${slot.reference.type}-${slot.reference.slot}`)}
            <SaveCard
              {slot}
              {mode}
              selected={referencesMatch(selected, slot.reference)}
              isContinueCandidate={referencesMatch(
                continueCandidate,
                slot.reference,
              )}
              onSelect={select}
              {onLoad}
              {onDelete}
            />
          {/each}
        </div>
      </section>
    {/if}

    <section class="slot-group" role="group" aria-label="手動存檔">
      <div class="group-heading">
        <h3>手動存檔</h3>
      </div>
      <div class="slot-grid manuals">
        {#each manualSaves as slot (`${slot.reference.type}-${slot.reference.slot}`)}
          <SaveCard
            {slot}
            {mode}
            selected={referencesMatch(selected, slot.reference)}
            isContinueCandidate={mode !== "manualSave" &&
              referencesMatch(continueCandidate, slot.reference)}
            onSelect={select}
            {onLoad}
            {onDelete}
          />
        {/each}
      </div>
    </section>
  {/if}
</section>

<style>
  .save-browser {
    box-sizing: border-box;
    display: grid;
    gap: 20px;
    width: min(1120px, 100%);
    max-height: min(86vh, 820px);
    padding: 20px;
    overflow: auto;
    border: 1px solid var(--rule-strong, #59636b);
    background: color-mix(in srgb, var(--void, #080b0e) 96%, transparent);
    color: var(--bone, #e8e0d1);
  }

  header,
  .group-heading {
    display: flex;
    align-items: start;
    justify-content: space-between;
    gap: 16px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  .eyebrow {
    color: var(--cyan, #65d8ea);
    font-size: 0.7rem;
    letter-spacing: 0.2em;
  }

  .slot-group {
    display: grid;
    gap: 10px;
  }

  .group-heading p {
    color: var(--bone-dim, #a7a092);
    font-size: 0.8rem;
  }

  .slot-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: 10px;
  }

  .manuals {
    grid-template-columns: repeat(3, minmax(180px, 1fr));
  }

  .global-state {
    min-height: 12rem;
    display: grid;
    place-items: center;
    gap: 12px;
    text-align: center;
  }

  .unavailable p {
    color: var(--crimson, #e77c86);
  }

  button {
    min-height: 36px;
    padding-inline: 14px;
    border: 1px solid var(--rule-strong, #59636b);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }

  @media (max-width: 720px) {
    .manuals {
      grid-template-columns: 1fr;
    }
  }
</style>
