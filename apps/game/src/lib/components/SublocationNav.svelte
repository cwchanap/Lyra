<script lang="ts">
  import type { SublocationView } from "../state/types";

  let {
    sublocations,
    currentId,
    onEnter,
    disabled = false,
    placement = "page",
    remaining = null,
  }: {
    sublocations: SublocationView[];
    currentId: string | null;
    onEnter: (id: string) => void;
    disabled?: boolean;
    placement?: "page" | "scene";
    /** Open targets per location; null hides the counts. */
    remaining?: Record<string, number> | null;
  } = $props();

  let chips: HTMLDivElement;
</script>

<nav class={["nav", { scene: placement === "scene" }]} aria-label="地點導航">
  <span class="eyebrow">地點 · LOCATIONS</span>
  <div
    class="chips"
    {@attach (node) => {
      chips = node;
      if (placement !== "scene") return;
      if (typeof ResizeObserver === "undefined") {
        node.classList.add("scrollbar-hidden");
        return;
      }
      const observer = new ResizeObserver(() => {
        if (node.clientHeight > 0 && node.clientHeight < 44) {
          node.classList.add("scrollbar-hidden");
        }
      });
      observer.observe(node);
      return () => observer.disconnect();
    }}
  >
    {#each sublocations as sub, i (sub.id)}
      <button
        class={{ active: sub.id === currentId }}
        {disabled}
        onclick={() => onEnter(sub.id)}
        type="button"
        {@attach (button) => {
          if (placement === "scene" && sub.id === currentId) {
            button.scrollIntoView?.({ inline: "nearest", block: "nearest" });
          }
        }}
      >
        <span class="idx">{String(i + 1).padStart(2, "0")}</span>
        <span class="label">{sub.label}</span>
        {#if remaining && (remaining[sub.id] ?? 0) > 0}
          <span class="remaining" aria-hidden="true">{remaining[sub.id]}</span>
          <span class="sr-only">（尚有 {remaining[sub.id]} 項未查）</span>
        {/if}
        {#if sub.id === currentId}
          <span class="active-mark">▸</span>
        {/if}
      </button>
    {/each}
  </div>
  {#if placement === "scene"}
    <button
      class="scroll-left"
      type="button"
      aria-label="向左捲動地點"
      {disabled}
      onclick={() => chips.scrollBy({ left: -160 })}>‹</button
    >
    <button
      class="scroll-right"
      type="button"
      aria-label="向右捲動地點"
      {disabled}
      onclick={() => chips.scrollBy({ left: 160 })}>›</button
    >
  {/if}
</nav>

<style>
  .nav {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px clamp(20px, 3vw, 40px);
    flex-wrap: wrap;
    pointer-events: auto;
  }

  .nav.scene {
    box-sizing: border-box;
    min-width: 0;
    max-width: 100%;
    max-height: 54px;
    gap: 8px;
    padding: 2px 10px;
    flex-wrap: nowrap;
    border: 1px solid var(--rule-strong);
    background: rgba(20, 20, 31, 0.72);
    backdrop-filter: blur(2px);
  }

  .eyebrow {
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--cyan);
    text-transform: uppercase;
    padding-right: 14px;
    border-right: 1px solid var(--rule-strong);
  }

  .chips {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }

  .scene .eyebrow {
    order: -2;
    flex: none;
    padding-right: 8px;
    border-right: 0;
    letter-spacing: 0.18em;
    white-space: nowrap;
  }

  .scene button {
    flex: none;
    min-height: 44px;
    gap: 4px;
    padding: 6px 7px;
    letter-spacing: 0.02em;
    white-space: nowrap;
  }

  .scene .chips {
    flex: 1;
    flex-wrap: nowrap;
    min-width: 0;
    height: 48px;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .scene .chips::-webkit-scrollbar {
    display: none;
  }

  @supports selector(::-webkit-scrollbar) {
    .scene .chips {
      scrollbar-width: auto;
      scrollbar-color: auto;
    }

    .scene .chips::-webkit-scrollbar {
      display: block;
      height: 4px;
    }

    .scene .chips::-webkit-scrollbar-thumb {
      background: var(--bone-faint);
    }

    .scene .chips:global(.scrollbar-hidden) {
      scrollbar-width: none;
    }

    .scene .chips:global(.scrollbar-hidden)::-webkit-scrollbar {
      display: none;
    }
  }

  .scene .scroll-left,
  .scene .scroll-right {
    width: 44px;
    justify-content: center;
    font-size: 20px;
  }

  .scene .scroll-left {
    order: -1;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px 7px;
    background: transparent;
    color: var(--bone-dim);
    border: 1px solid var(--rule-strong);
    cursor: pointer;
    font: inherit;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.06em;
    transition:
      color 0.18s,
      border-color 0.18s,
      background 0.18s;
  }

  button:hover:not(:disabled) {
    color: var(--bone);
    border-color: var(--bone-dim);
  }

  button.active {
    color: var(--bone);
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  button:disabled {
    opacity: 0.5;
    cursor: wait;
  }

  .idx {
    font-family: var(--mono);
    font-size: 10px;
    letter-spacing: 0.18em;
    color: var(--bone-faint);
  }

  button.active .idx {
    color: var(--crimson);
  }

  .remaining {
    display: inline-grid;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    place-items: center;
    border: 1px solid var(--cyan);
    border-radius: 999px;
    color: var(--cyan);
    font-family: var(--mono);
    font-size: 10px;
    line-height: 1;
  }

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

  .active-mark {
    color: var(--crimson);
    font-size: 11px;
  }
</style>
