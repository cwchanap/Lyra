<script lang="ts">
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import CrossfadeImage from "./CrossfadeImage.svelte";

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
      <span class="stamp">
        <span class="kana">場 / SCENE</span>
        <span class="label">{sceneTag}</span>
      </span>
    {/if}
  </div>
{/if}

<style>
  .backdrop {
    position: relative;
    padding: 18px clamp(20px, 3vw, 40px);
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

  .stamp {
    position: relative;
    /* Above the dialogue portrait (fixed, z-index 20 in the same <main>
       stacking context) and below the dialogue box (30): a left-placed
       portrait starts at 20vh and otherwise covers a wrapped scene tag. */
    z-index: 25;
    max-width: 100%;
    display: inline-flex;
    align-items: stretch;
    border: 1px solid var(--rule-strong);
    background: rgba(20, 20, 31, 0.6);
    backdrop-filter: blur(2px);
    transform: rotate(-1.2deg);
    font-family: var(--serif-jp);
    box-shadow: 4px 4px 0 var(--cell);
  }

  .kana {
    padding: 6px 10px 5px;
    font-family: var(--impact);
    font-weight: 500;
    font-size: 10px;
    letter-spacing: 0.32em;
    color: var(--bone);
    background: var(--crimson);
    text-transform: uppercase;
    display: inline-flex;
    flex: none;
    align-items: center;
    /* A long scene tag must not squeeze the badge into a tall column. */
    white-space: nowrap;
  }

  .label {
    padding: 6px 14px 5px;
    font-family: var(--serif-jp);
    font-weight: 500;
    font-size: 13px;
    color: var(--bone);
    letter-spacing: 0.08em;
    display: inline-flex;
    min-width: 0;
    align-items: center;
    line-height: 1.5;
    /* Even out a wrapped scene tag instead of leaving one orphaned
       character on its last line. */
    text-wrap: balance;
  }
</style>
