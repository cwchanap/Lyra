<script lang="ts">
  import type { ObjectiveView } from "../state/types";

  let {
    objective,
    compact = false,
  }: { objective: ObjectiveView | null; compact?: boolean } = $props();
</script>

{#if objective}
  <section
    class={["primary-objective-hud", { compact }]}
    role="status"
    aria-label="主要目標"
  >
    <p class="eyebrow">主要目標 / PRIMARY OBJECTIVE</p>
    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <div
      class="label-scroll"
      role="region"
      aria-label="主要目標內容"
      tabindex={compact ? 0 : undefined}
    >
      <p class="label">{objective.label}</p>
    </div>
  </section>
{/if}

<style>
  .primary-objective-hud {
    display: grid;
    gap: 4px;
    max-width: min(100%, 540px);
    padding: 10px 12px;
    border-left: 2px solid var(--crimson);
    background: color-mix(in srgb, var(--ink) 82%, transparent);
    color: var(--bone);
    pointer-events: none;
  }

  .primary-objective-hud.compact {
    box-sizing: border-box;
    grid-template-rows: auto minmax(0, 1fr);
    max-height: 74px;
  }

  .compact .label-scroll {
    min-height: 0;
    overflow-y: auto;
    overflow-wrap: anywhere;
    pointer-events: auto;
    scrollbar-width: thin;
  }

  .label-scroll:focus-visible {
    outline: 1px solid var(--cyan);
    outline-offset: -1px;
  }

  .eyebrow,
  .label {
    margin: 0;
  }

  .eyebrow {
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
  }

  .label {
    font-family: var(--serif-jp);
    font-size: 15px;
    line-height: 1.4;
  }
</style>
