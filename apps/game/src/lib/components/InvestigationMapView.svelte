<script lang="ts">
  import CrossfadeImage from "./CrossfadeImage.svelte";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
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

  let background = $state<ResolvedStoryAsset | null>(null);

  $effect(() => {
    let cancelled = false;

    resolveStoryAsset(map.backgroundAssetId, "background")
      .then((asset) => {
        if (!cancelled) background = asset;
      })
      .catch(() => {
        if (!cancelled)
          background = placeholderForMissingStoryAsset(
            map.backgroundAssetId ?? "background.unknown",
            "background",
          );
      });

    return () => {
      cancelled = true;
    };
  });

  // Projected nodes are already filtered server-side to visible/unlocked
  // sublocations (HPA-601 §7); join with the visible sublocations for labels.
  let destinations = $derived(
    map.nodes.flatMap((node) => {
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
  <CrossfadeImage
    src={background?.url ?? null}
    imageClass="map-background"
    alt=""
    ariaHidden={true}
    onImageError={handleBackgroundError}
  />

  <header class="map-objective">
    <span class="eyebrow">目的地 · DESTINATION</span>
    <p>{summary}</p>
  </header>

  <div class="map-plane">
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

  .city-map :global(img.map-background) {
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

  .pin-label {
    font-family: var(--serif-jp);
    font-size: 13px;
    letter-spacing: 0.08em;
    line-height: 1.2;
  }

  button:disabled {
    opacity: 0.55;
    cursor: wait;
  }

  @media (max-width: 720px) {
    /* lyra-mobile-breakpoint — see tokens.css. */
    .pin-label {
      display: none;
    }
  }
</style>
