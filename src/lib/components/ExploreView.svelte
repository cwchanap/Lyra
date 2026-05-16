<script lang="ts">
  import type { SceneView } from "../state/types";
  import SublocationNav from "./SublocationNav.svelte";
  import HotspotGrid from "./HotspotGrid.svelte";
  import CharacterList from "./CharacterList.svelte";

  let {
    scene,
    onInspect,
    onInterview,
    onEnterSublocation,
  }: {
    scene: SceneView;
    onInspect: (id: string) => void;
    onInterview: (cId: string, tId: string) => void;
    onEnterSublocation: (id: string) => void;
  } = $props();

  let inv = $derived(scene.kind === "investigation" ? scene : null);
  let currentSub = $derived(
    inv?.visibleSublocations.find((s) => s.id === inv.currentSublocationId) ?? null,
  );
</script>

{#if inv && currentSub}
  <SublocationNav
    sublocations={inv.visibleSublocations}
    currentId={inv.currentSublocationId}
    onEnter={onEnterSublocation}
  />
  <HotspotGrid hotspots={currentSub.hotspots} {onInspect} />
  <CharacterList characters={currentSub.characters} {onInterview} />
{:else if inv}
  <p class="muted">尚未進入任何地點。</p>
{/if}

<style>
  .muted { padding: 24px; color: #8b949e; }
</style>
