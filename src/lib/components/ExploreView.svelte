<script lang="ts">
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
  }: {
    scene: SceneView;
    backgroundAssetId?: string | null;
    onInspect: (id: string) => void;
    onInterview: (cId: string, tId: string) => void;
    onEnterSublocation: (id: string) => void;
    disabled?: boolean;
  } = $props();

  let inv = $derived(scene.kind === "investigation" ? scene : null);
  let currentSub = $derived(
    inv?.visibleSublocations.find((s) => s.id === inv.currentSublocationId) ??
      null,
  );
</script>

{#if inv && currentSub}
  <SublocationNav
    sublocations={inv.visibleSublocations}
    currentId={inv.currentSublocationId}
    onEnter={onEnterSublocation}
    {disabled}
  />
  <InvestigationSceneSurface
    sublocation={currentSub}
    {backgroundAssetId}
    {onInspect}
    {onInterview}
    {disabled}
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
</style>
