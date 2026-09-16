<script lang="ts">
  import CrossfadeImage from "./CrossfadeImage.svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import { initialActiveRegionId, projectMapPlane } from "../state/map-plane";
  import type { InvestigationMapView, SublocationView } from "../state/types";

  let {
    map,
    sublocations,
    summary,
    onTravel,
    disabled = false,
  }: {
    map: InvestigationMapView;
    sublocations: SublocationView[];
    summary: string;
    onTravel: (id: string) => void;
    disabled?: boolean;
  } = $props();

  // Pending-map plane state is presentation-only: region/overview switching
  // never reaches gameplay (only `data-map-destination` leaves call onTravel).
  // The effect's first run projects the opening plane; a different scene
  // swapping in a different map re-projects it, while same-scene state
  // refreshes (same map id) keep the player's chosen plane.
  let activeRegionId = $state<string | null>(null);
  let projectedMapId: string | null = null;
  $effect(() => {
    if (map.id !== projectedMapId) {
      projectedMapId = map.id;
      activeRegionId = initialActiveRegionId(map.nodes);
    }
  });

  const plane = $derived(projectMapPlane(map, activeRegionId));
  // One crossfade identity per plane; an invalid region id already fell back
  // to the overview plane inside projectMapPlane.
  const planeKey = $derived(plane.regionId ?? "overview");
  const planeBackgroundAssetId = $derived(
    plane.region ? plane.region.backgroundAssetId : map.backgroundAssetId,
  );

  let background = $state<ResolvedStoryAsset | null>(null);

  $effect(() => {
    let cancelled = false;

    resolveStoryAsset(planeBackgroundAssetId, "background")
      .then((asset) => {
        if (!cancelled) background = asset;
      })
      .catch(() => {
        if (!cancelled)
          background = placeholderForMissingStoryAsset(
            planeBackgroundAssetId ?? "background.unknown",
            "background",
          );
      });

    return () => {
      cancelled = true;
    };
  });

  // Only trust the resolved asset while it belongs to the active plane, so a
  // plane switch always passes CrossfadeImage a null src first and its
  // stale-request rejection stays keyed per plane.
  const planeAsset = $derived(
    background && background.assetId === planeBackgroundAssetId
      ? background
      : null,
  );

  // Key of the plane whose raster actually loaded (or failed over to its
  // placeholder). CrossfadeImage only forwards load/error for the current
  // request, so this can never name a stale plane.
  let loadedPlaneKey = $state<string | null>(null);
  // Raster-less planes bypass the load gate: named controls render immediately.
  const markersReady = $derived(
    planeBackgroundAssetId == null || loadedPlaneKey === planeKey,
  );

  function markPlaneLoaded() {
    loadedPlaneKey = planeKey;
  }

  // Projected nodes are already filtered server-side to visible/unlocked
  // sublocations (HPA-601 §7); join with the visible sublocations for labels.
  let destinations = $derived(
    plane.nodes.flatMap((node) => {
      const sublocation = sublocations.find(
        (candidate) => candidate.id === node.sublocationId,
      );
      return sublocation
        ? [{ id: node.sublocationId, label: sublocation.label, ...node }]
        : [];
    }),
  );

  // Same normalized-coordinate convention as InvestigationSceneSurface.
  function percent(value: number) {
    return `${value * 100}%`;
  }

  function pinStyle(x: number, y: number) {
    return `--x: ${percent(x)}; --y: ${percent(y)};`;
  }

  function handleBackgroundError() {
    // A failed raster still opens its plane's controls; the placeholder
    // fallback below stays clickable.
    loadedPlaneKey = planeKey;
    if (!background || background.placeholder) return;
    console.warn(
      `[InvestigationMapView] Missing background asset: ${background.url} (assetId: ${background.assetId})`,
    );
    background = placeholderForMissingStoryAsset(
      background.assetId,
      "background",
    );
  }
</script>

<section class="city-map" aria-label="城市地圖">
  <header class="map-objective">
    <span class="eyebrow">目的地 · DESTINATION</span>
    <p>{summary}</p>
  </header>

  <!-- Spec §8: the plane is the single 16:9 coordinate plane; the background
       lives inside it so the raster and the normalized --x/--y pins scale
       together instead of tracking the section's arbitrary box. -->
  <div class="map-plane">
    <CrossfadeImage
      src={planeAsset?.url ?? null}
      transitionKey={planeKey}
      imageClass="map-background"
      alt=""
      ariaHidden={true}
      onImageLoad={markPlaneLoaded}
      onImageError={handleBackgroundError}
    />

    {#if markersReady}
      {#each plane.regions as region (region.id)}
        <!-- Presentation-only district control; never a gameplay command. -->
        <button
          class="map-pin map-region"
          type="button"
          data-map-region={region.id}
          aria-label={`檢視${region.label}地圖`}
          style={pinStyle(region.x, region.y)}
          onclick={() => (activeRegionId = region.id)}
        >
          <span class="pin-dot"></span>
          <span class="pin-label">{region.label}</span>
        </button>
      {/each}

      {#each destinations as destination (destination.id)}
        <button
          class="map-pin"
          type="button"
          data-map-destination={destination.id}
          aria-label={`前往：${destination.label} — ${summary}`}
          style={pinStyle(destination.x, destination.y)}
          {disabled}
          onclick={() => onTravel(destination.id)}
        >
          <span class="pin-dot"></span>
          <span class="pin-label">{destination.label}</span>
        </button>
      {/each}
    {/if}

    {#if plane.kind === "district"}
      <button
        class="map-overview-return"
        type="button"
        data-map-overview=""
        onclick={() => (activeRegionId = null)}
      >
        返回全景地圖
      </button>
    {/if}
  </div>
</section>

<style>
  .city-map {
    position: relative;
    display: grid;
    place-items: center;
    width: 100%;
    padding: clamp(16px, 4vh, 48px) clamp(20px, 3vw, 40px);
  }

  .map-plane :global(img.map-background) {
    position: absolute;
    inset: 0;
    z-index: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    pointer-events: none;
  }

  .map-objective {
    position: absolute;
    left: clamp(20px, 3vw, 40px);
    top: clamp(16px, 4vh, 48px);
    z-index: 2;
    display: grid;
    gap: 4px;
    max-width: min(100%, 540px);
    padding: 10px 12px;
    border-left: 2px solid var(--crimson);
    background: color-mix(in srgb, var(--ink) 82%, transparent);
    color: var(--bone);
  }

  .eyebrow {
    color: var(--bone-faint);
    font-family: var(--impact);
    font-size: 10px;
    letter-spacing: 0.18em;
  }

  .map-objective p {
    margin: 0;
    font-family: var(--serif-jp);
    font-size: 15px;
    line-height: 1.4;
  }

  .map-plane {
    position: relative;
    z-index: 1;
    width: min(100%, 160vh);
    aspect-ratio: 16 / 9;
  }

  .map-pin {
    position: absolute;
    left: var(--x);
    top: var(--y);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-width: 72px;
    min-height: 44px;
    padding: 8px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--bone);
    cursor: pointer;
    font: inherit;
    transform: translate(-50%, -50%);
    transition:
      border-color 0.18s,
      background 0.18s;
  }

  .map-pin:hover:not(:disabled),
  .map-pin:focus-visible:not(:disabled) {
    border-color: var(--crimson);
    background: var(--crimson-soft);
  }

  .pin-dot {
    flex: 0 0 auto;
    width: 11px;
    height: 11px;
    border-radius: 999px;
    background: var(--cyan);
    box-shadow: 0 0 14px rgba(113, 209, 220, 0.72);
  }

  /* District region controls share the pin geometry but read as place marks,
     not travel leaves. */
  .map-region .pin-dot {
    background: var(--crimson);
    box-shadow: 0 0 14px color-mix(in srgb, var(--crimson) 55%, transparent);
  }

  .pin-label {
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
    line-height: 1.2;
  }

  .map-overview-return {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 2;
    min-height: 44px;
    padding: 8px 14px;
    border: 1px solid var(--crimson);
    background: color-mix(in srgb, var(--ink) 82%, transparent);
    color: var(--bone);
    cursor: pointer;
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
  }

  .map-overview-return:hover,
  .map-overview-return:focus-visible {
    background: var(--crimson-soft);
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }
</style>
