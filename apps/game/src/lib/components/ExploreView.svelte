<script lang="ts">
  import type { Snippet } from "svelte";
  import type { SceneView } from "../state/types";
  import SublocationNav from "./SublocationNav.svelte";
  import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";

  let {
    scene,
    backgroundAssetId = null,
    onInspect,
    onInterview,
    onEnterSublocation,
    disabled = false,
    hud,
  }: {
    scene: SceneView;
    backgroundAssetId?: string | null;
    onInspect: (id: string) => void;
    onInterview: (cId: string, tId: string) => void;
    onEnterSublocation: (id: string) => void;
    disabled?: boolean;
    hud?: Snippet;
  } = $props();

  let inv = $derived(scene.kind === "investigation" ? scene : null);
  let currentSub = $derived(
    inv?.visibleSublocations.find((s) => s.id === inv.currentSublocationId) ??
      null,
  );
</script>

{#if inv && currentSub}
  {#snippet sceneHud()}
    <div class="explore-hud">
      <SublocationNav
        sublocations={inv.visibleSublocations}
        currentId={inv.currentSublocationId}
        onEnter={onEnterSublocation}
        {disabled}
        placement="scene"
      />
      {#if hud}
        {@render hud()}
      {/if}
    </div>
  {/snippet}

  <InvestigationSceneSurface
    sublocation={currentSub}
    {backgroundAssetId}
    {onInspect}
    {onInterview}
    {disabled}
    hud={sceneHud}
  />
{:else if inv}
  <p class="muted">尚未進入任何地點。</p>
{/if}

<style>
  .muted {
    padding: 24px clamp(20px, 3vw, 40px);
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-style: italic;
  }

  .explore-hud {
    position: absolute;
    top: 76px;
    left: clamp(20px, 3vw, 40px);
    right: clamp(20px, 3vw, 40px);
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    justify-content: space-between;
    gap: 10px;
    pointer-events: none;
  }

  /* Keep the scene objective compact so it sits beside (wide viewports) or
     wraps below (narrow viewports) the location navigator without the two
     independently pinning the same top offset. */
  .explore-hud :global(.primary-objective-hud) {
    max-width: min(360px, 100%);
  }

  @media (max-width: 720px) {
    /* lyra-mobile-breakpoint — see tokens.css. */
    .explore-hud {
      top: 72px;
      left: 12px;
      right: 12px;
    }
  }
</style>
