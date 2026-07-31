<script lang="ts">
  import type { ObjectiveView } from "../state/types";

  let { objective }: { objective: ObjectiveView | null } = $props();
</script>

{#if objective}
  <section class="primary-objective-hud" role="status" aria-label="主要目標">
    <p class="eyebrow">主要目標 / PRIMARY OBJECTIVE</p>
    <p class="label">{objective.label}</p>
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

  :global(.scene-hud) .primary-objective-hud {
    position: fixed;
    top: 76px;
    right: clamp(20px, 3vw, 40px);
    max-width: min(360px, calc(100vw - 40px));
  }

  @media (max-width: 720px) {
    :global(.scene-hud) .primary-objective-hud {
      top: 138px;
      right: 12px;
      left: 12px;
      max-width: none;
    }
  }
</style>
