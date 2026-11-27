<script lang="ts">
  import {
    alphaBoundsFromImageData,
    cropVariablesForAlphaBounds,
  } from "@lyra/shared";
  import {
    placeholderForMissingStoryAsset,
    resolveStoryAsset,
    type ResolvedStoryAsset,
  } from "$lib/assets/story-assets";
  import type { PortraitRef } from "../state/types";
  import CrossfadeImage from "./CrossfadeImage.svelte";

  let { portrait }: { portrait: PortraitRef | null } = $props();

  let resolved = $state<ResolvedStoryAsset | null>(null);
  let cropStyles = $state<Record<string, string | null>>({});

  let portraitAssetId = $derived(portrait?.assetId ?? null);
  let portraitSource = $derived(resolved?.url ?? null);
  let transitionKey = $derived(
    portrait && portraitSource
      ? `${portrait.characterId}:${portrait.expression}:${portraitSource}`
      : null,
  );
  let cropStyle = $derived(
    portraitAssetId ? (cropStyles[portraitAssetId] ?? "") : "",
  );

  $effect(() => {
    const assetId = portraitAssetId;
    let cancelled = false;
    resolved = null;

    if (!assetId) return;

    resolveStoryAsset(assetId, "portrait")
      .then((asset) => {
        if (!cancelled) resolved = asset;
      })
      .catch(() => {
        if (!cancelled) {
          resolved = placeholderForMissingStoryAsset(assetId, "portrait");
        }
      });

    return () => {
      cancelled = true;
    };
  });

  function rememberCrop(assetId: string, style: string | null) {
    cropStyles = { ...cropStyles, [assetId]: style };
  }

  function handleImageLoad(event: Event) {
    const assetId = portraitAssetId;
    if (!assetId || Object.prototype.hasOwnProperty.call(cropStyles, assetId)) {
      return;
    }

    const image = event.currentTarget;
    /* v8 ignore next -- unreachable: CrossfadeImage only renders <img> elements, so event.currentTarget is always an HTMLImageElement */
    if (!(image instanceof HTMLImageElement)) {
      rememberCrop(assetId, null);
      return;
    }

    const imageWidth = image.naturalWidth;
    const imageHeight = image.naturalHeight;
    if (!imageWidth || !imageHeight) {
      rememberCrop(assetId, null);
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.width = imageWidth;
    canvas.height = imageHeight;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) {
      rememberCrop(assetId, null);
      return;
    }

    try {
      context.drawImage(image, 0, 0);
      const imageData = context.getImageData(0, 0, imageWidth, imageHeight);
      const bounds = alphaBoundsFromImageData(
        imageData.data,
        imageWidth,
        imageHeight,
      );
      rememberCrop(
        assetId,
        bounds
          ? cropVariablesForAlphaBounds(bounds, imageWidth, imageHeight)
          : null,
      );
    } catch {
      rememberCrop(assetId, null);
    }
  }

  function handleImageError() {
    if (!resolved || resolved.placeholder) return;
    console.warn(
      `[InterrogationSubjectArt] Missing portrait asset: ${resolved.url} (assetId: ${resolved.assetId})`,
    );
    resolved = placeholderForMissingStoryAsset(resolved.assetId, "portrait");
  }
</script>

<div
  class="interrogation-subject-art"
  data-interrogation-subject-art=""
  aria-hidden="true"
>
  <CrossfadeImage
    src={portraitSource}
    {transitionKey}
    imageClass="portrait interrogation-subject-portrait"
    imageStyle={cropStyle}
    dataAttributes={{
      "save-thumbnail-asset-role": "portrait",
    }}
    alt=""
    ariaHidden={true}
    onImageLoad={handleImageLoad}
    onImageError={handleImageError}
  />
</div>

<style>
  .interrogation-subject-art {
    position: absolute;
    z-index: 1;
    left: calc(26px + min(360px, 46vw) + 12px);
    right: 26px;
    top: calc(24px + var(--interrogation-toolbar-height, 0px) + 8px);
    bottom: 0;
    pointer-events: none;
  }

  .interrogation-subject-art :global(img.interrogation-subject-portrait) {
    position: absolute;
    top: 0;
    left: 0;
    width: auto;
    height: auto;
    max-width: calc(100% / var(--crop-width, 1));
    max-height: calc(100% / var(--crop-height, 1));
    object-fit: contain;
    object-position: left top;
    transform: translate(
      calc(-100% * var(--crop-left, 0)),
      calc(-100% * var(--crop-top, 0))
    );
    transform-origin: left top;
    pointer-events: none;
  }

  @media (prefers-reduced-motion: reduce) {
    .interrogation-subject-art :global(img) {
      transition: none;
    }
  }
</style>
