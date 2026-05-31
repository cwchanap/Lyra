<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    placeholderForStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import type { Inventory } from "../state/types";

  let {
    inventory,
    reexamineEnabled,
    onReexamineEvidence,
    onReexamineStatement,
    disabled = false,
  }: {
    inventory: Inventory;
    reexamineEnabled: boolean;
    onReexamineEvidence: (id: string) => void;
    onReexamineStatement: (id: string) => void;
    disabled?: boolean;
  } = $props();

  let open = $state(false);
  let evidenceImages = $state<Record<string, ResolvedStoryAsset>>({});

  $effect(() => {
    let cancelled = false;
    const entries = inventory.evidence
      .map((e) => [e.id, e.imageAssetId] as const)
      .filter((entry): entry is [string, string] => !!entry[1]);

    for (const [id, imageAssetId] of entries) {
      resolveStoryAsset(imageAssetId, "evidence").then((asset) => {
        if (!cancelled) {
          evidenceImages = {
            ...evidenceImages,
            [id]: asset ?? placeholderForStoryAsset("evidence"),
          };
        }
      });
    }

    return () => {
      cancelled = true;
    };
  });

  function handleEvidenceImageError(id: string) {
    const current = evidenceImages[id];
    if (!current || current.placeholder) return;
    evidenceImages = {
      ...evidenceImages,
      [id]: placeholderForMissingStoryAsset(current.assetId, "evidence"),
    };
  }
</script>

<aside class:open>
  <button class="toggle" type="button" onclick={() => (open = !open)} aria-expanded={open}>
    <span class="t-marker"></span>
    <span class="t-body">
      <span class="t-zh">{open ? "收合" : "物證"}</span>
      <span class="t-en">EVIDENCE {open ? "▸" : "◂"}</span>
    </span>
    <span class="t-counts">
      <span><b>{inventory.evidence.length}</b> 證</span>
      <span><b>{inventory.statements.length}</b> 言</span>
    </span>
  </button>

  {#if open}
    <div class="panel" role="region" aria-label="物證清單">
      <header class="panel-head">
        <span class="eyebrow">DOSSIER · 物證檔案</span>
        <span class="sub">{inventory.evidence.length + inventory.statements.length} 項已歸檔</span>
      </header>

      <section>
        <h3>
          <span class="kind-tag">證</span>
          證物 <span class="cnt">({inventory.evidence.length})</span>
        </h3>
        {#if inventory.evidence.length === 0}
          <p class="empty">尚未收集。</p>
        {/if}
        {#each inventory.evidence as e, i (e.id)}
          <button
            class:evidence-row={!!evidenceImages[e.id]}
            type="button"
            disabled={!reexamineEnabled || disabled}
            onclick={() => onReexamineEvidence(e.id)}
          >
            <span class="num">{String(i + 1).padStart(2, "0")}</span>
            {#if evidenceImages[e.id]}
              <img
                class="evidence-thumb"
                src={evidenceImages[e.id].url}
                alt=""
                aria-hidden="true"
                onerror={() => handleEvidenceImageError(e.id)}
              />
            {/if}
            <span class="entry">
              <strong>{e.name}</strong>
              <small>{e.description}</small>
            </span>
          </button>
        {/each}
      </section>

      <section>
        <h3>
          <span class="kind-tag alt">言</span>
          證言 <span class="cnt">({inventory.statements.length})</span>
        </h3>
        {#if inventory.statements.length === 0}
          <p class="empty">尚未取得。</p>
        {/if}
        {#each inventory.statements as s, i (s.id)}
          <button
            class="statement-row"
            type="button"
            disabled={!reexamineEnabled || disabled}
            onclick={() => onReexamineStatement(s.id)}
          >
            <span class="num">{String(i + 1).padStart(2, "0")}</span>
            <span class="entry">
              <strong>{s.speaker}</strong>
              <small>{s.content}</small>
            </span>
          </button>
        {/each}
      </section>
    </div>
  {/if}
</aside>

<style>
  aside {
    position: fixed;
    top: 80px;
    right: 0;
    width: 360px;
    max-width: calc(100vw - 24px);
    pointer-events: none;
    z-index: 40;
  }

  .toggle {
    pointer-events: auto;
    display: flex;
    align-items: stretch;
    gap: 0;
    padding: 0;
    margin-right: 0;
    margin-left: auto;
    background: var(--char);
    color: var(--bone);
    border: 1px solid var(--rule-strong);
    border-right: none;
    cursor: pointer;
    font: inherit;
    transition: border-color 0.18s, background 0.18s;
  }

  .toggle:hover {
    border-color: var(--crimson);
    background: var(--char-2);
  }

  .t-marker {
    width: 4px;
    background: var(--crimson);
  }

  .t-body {
    display: flex;
    flex-direction: column;
    gap: 2px;
    align-items: flex-start;
    padding: 8px 14px;
    border-right: 1px solid var(--rule);
  }

  .t-zh {
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 13px;
    letter-spacing: 0.12em;
    line-height: 1;
    color: var(--bone);
  }

  .t-en {
    font-family: var(--mono);
    font-size: 9px;
    letter-spacing: 0.22em;
    color: var(--bone-faint);
    text-transform: uppercase;
  }

  .t-counts {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 4px;
    padding: 8px 14px;
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-dim);
  }

  .t-counts b {
    color: var(--crimson);
    font-weight: 500;
    font-family: var(--impact);
    font-size: 13px;
  }

  .panel {
    pointer-events: auto;
    margin-top: 8px;
    margin-right: 12px;
    padding: 14px 14px 18px;
    background: var(--char);
    border: 1px solid var(--rule-strong);
    border-left: 2px solid var(--crimson);
    max-height: calc(100vh - 130px);
    overflow-y: auto;
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
  }

  .panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 12px;
    padding-bottom: 10px;
    border-bottom: 1px solid var(--rule);
  }

  .eyebrow {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
  }

  .sub {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
  }

  h3 {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 16px 0 8px;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 14px;
    letter-spacing: 0.1em;
    color: var(--bone);
  }

  .kind-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    font-family: var(--display-jp);
    font-size: 11px;
    color: var(--bone);
    background: var(--crimson-deep);
    border: 1px solid var(--crimson);
  }

  .kind-tag.alt {
    background: var(--cyan-deep);
    border-color: var(--cyan);
  }

  .cnt {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
    margin-left: 4px;
  }

  section button {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 10px;
    width: 100%;
    text-align: left;
    padding: 8px 10px;
    margin-bottom: 6px;
    background: transparent;
    border: 1px solid var(--rule);
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    transition: border-color 0.18s, background 0.18s;
  }

  section button.evidence-row {
    grid-template-columns: 32px 36px 1fr;
  }

  section button:hover:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  section button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  section button:disabled:hover {
    border-color: var(--rule);
    background: transparent;
  }

  .num {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.12em;
    color: var(--bone-faint);
    align-self: start;
  }

  section button:hover:not(:disabled) .num {
    color: var(--crimson);
  }

  .entry {
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }

  .evidence-thumb {
    width: 36px;
    height: 36px;
    object-fit: cover;
    align-self: start;
    border: 1px solid var(--rule-strong);
    background: var(--cell);
  }

  section button strong {
    display: block;
    font-family: var(--display-jp);
    font-weight: 400;
    font-size: 13px;
    letter-spacing: 0.06em;
    color: var(--bone);
  }

  section button small {
    color: var(--bone-dim);
    font-family: var(--serif-jp);
    font-size: 12px;
    line-height: 1.5;
  }

  .empty {
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-style: italic;
    font-size: 12px;
    margin: 0 0 6px;
  }
</style>
