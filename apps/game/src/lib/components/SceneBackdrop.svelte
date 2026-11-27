<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import CrossfadeImage from "./CrossfadeImage.svelte";
  import SceneStamp from "./SceneStamp.svelte";

  let {
    sceneTag,
    backgroundAssetId = null,
  }: {
    sceneTag: string | null;
    backgroundAssetId?: string | null;
  } = $props();

  let resolved = $state<ResolvedStoryAsset | null>(null);

  $effect(() => {
    let cancelled = false;
    resolveStoryAsset(backgroundAssetId, "background").then((asset) => {
      if (!cancelled) resolved = asset;
    });
    return () => {
      cancelled = true;
    };
  });

  function handleBackgroundError() {
    if (!resolved || resolved.placeholder) return;
    console.warn(
      `[SceneBackdrop] Missing background asset: ${resolved.url} (assetId: ${resolved.assetId})`,
    );
    resolved = placeholderForMissingStoryAsset(resolved.assetId, "background");
  }
</script>

{#if sceneTag || backgroundAssetId || resolved}
  <div class="backdrop" data-save-thumbnail-layout="backdrop">
    <CrossfadeImage
      src={resolved?.url ?? null}
      imageClass="background-image"
      imageStyle="--crossfade-visible-opacity: 0.52;"
      dataAttributes={{ "save-thumbnail-asset-role": "background" }}
      alt=""
      ariaHidden={true}
      onImageError={handleBackgroundError}
    />
    {#if sceneTag}
      <SceneStamp {sceneTag} />
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: relative;
    padding: 6px clamp(20px, 3vw, 40px) calc(6px + 1.1vw);
    min-height: 1px;
  }

  .backdrop :global(img.background-image) {
    position: fixed;
    inset: 0;
    z-index: -1;
    width: 100vw;
    height: 100vh;
    object-fit: cover;
    pointer-events: none;
  }
</style>
