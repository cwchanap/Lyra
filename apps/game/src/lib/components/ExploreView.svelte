<script lang="ts">
  import type { Snippet } from "svelte";
  import type { FeedbackLine, Inventory, SceneView } from "../state/types";
  import SublocationNav from "./SublocationNav.svelte";
  import InvestigationSceneSurface from "./InvestigationSceneSurface.svelte";
  import InvestigationMapView from "./InvestigationMapView.svelte";
  import InvestigationProgressHud from "./InvestigationProgressHud.svelte";
  import MenuTrigger from "./MenuTrigger.svelte";
  import { remainingTargetsBySublocation } from "$lib/investigation/progress";

  let {
    scene,
    backgroundAssetId = null,
    onInspect,
    onInterview,
    onEnterSublocation,
    inventory = { evidence: [], statements: [] },
    onPresent = () => {},
    presentFeedback = null,
    onOpenGameMenu,
    disabled = false,
    hud,
  }: {
    scene: SceneView;
    backgroundAssetId?: string | null;
    onInspect: (id: string) => void;
    onInterview: (cId: string, tId: string) => void;
    onEnterSublocation: (id: string) => void;
    inventory?: Inventory;
    onPresent?: (
      characterId: string,
      kind: "evidence" | "statement",
      itemId: string,
    ) => void;
    presentFeedback?: { characterId: string; line: FeedbackLine } | null;
    onOpenGameMenu?: (trigger: HTMLElement) => void;
    disabled?: boolean;
    hud?: Snippet;
  } = $props();

  let inv = $derived(scene.kind === "investigation" ? scene : null);
  let currentSub = $derived(
    inv?.visibleSublocations.find((s) => s.id === inv.currentSublocationId) ??
      null,
  );
  let outroProgress = $derived(inv?.outroProgress ?? null);
  // Per-location counts only mean "work left before the scene moves on" when
  // the auto outro decides the exit.
  let remainingBySublocation = $derived(
    inv && outroProgress
      ? remainingTargetsBySublocation(inv.visibleSublocations)
      : null,
  );
</script>

{#if inv && currentSub}
  {#snippet sceneHud()}
    <div class="explore-hud">
      <!-- HPA-601 §8: when the scene is mapped, the city map is the only
           travel surface — SublocationNav is suppressed completely. -->
      {#if !inv.map}
        <SublocationNav
          sublocations={inv.visibleSublocations}
          currentId={inv.currentSublocationId}
          onEnter={onEnterSublocation}
          {disabled}
          placement="scene"
          remaining={remainingBySublocation}
        />
      {/if}
      <div class="hud-side">
        <InvestigationProgressHud progress={outroProgress} />
        {#if hud}
          {@render hud()}
        {/if}
        <MenuTrigger {disabled} onOpen={onOpenGameMenu} />
      </div>
    </div>
  {/snippet}

  <InvestigationSceneSurface
    sublocation={currentSub}
    {backgroundAssetId}
    {onInspect}
    {onInterview}
    {inventory}
    {onPresent}
    {presentFeedback}
    {disabled}
    hud={sceneHud}
    surfaceKey={`${inv.id}/${currentSub.id}`}
  />
{:else if inv && inv.map && inv.currentSublocationId === null}
  {#key inv.id}
    <InvestigationMapView
      map={inv.map}
      sublocations={inv.visibleSublocations}
      summary={inv.summary}
      onTravel={onEnterSublocation}
      {onOpenGameMenu}
      {disabled}
    />
  {/key}
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
    display: contents;
  }

  .explore-hud :global(nav) {
    grid-column: 1 / -1;
    grid-row: 2;
  }

  .explore-hud :global(.primary-objective-hud) {
    flex: 1 1 280px;
    min-width: 0;
    max-width: 280px;
    padding: 6px 10px;
  }

  .explore-hud :global(.investigation-progress) {
    flex: none;
  }

  .hud-side {
    grid-column: 2;
    grid-row: 1;
    display: flex;
    min-width: 0;
    max-height: 74px;
    flex-wrap: nowrap;
    justify-content: flex-end;
    gap: 8px;
  }
</style>
