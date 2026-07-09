<script lang="ts">
  import { SvelteMap } from "svelte/reactivity";

  type ImageDataAttributeValue = string | number | boolean | null | undefined;

  type ImageLayer = {
    id: number;
    src: string;
    visible: boolean;
    leaving: boolean;
    pending: boolean;
  };

  let {
    src,
    alt = "",
    imageClass = "",
    imageStyle = "",
    durationMs = 300,
    ariaHidden = true,
    dataAttributes = {},
    onImageLoad,
    onImageError,
  }: {
    src: string | null;
    alt?: string;
    imageClass?: string;
    imageStyle?: string;
    durationMs?: number;
    ariaHidden?: boolean | "true" | "false";
    dataAttributes?: Record<string, ImageDataAttributeValue>;
    onImageLoad?: (event: Event) => void;
    onImageError?: (event: Event) => void;
  } = $props();

  let layers = $state<ImageLayer[]>([]);
  let layerSequence = 0;
  let lastRequestedSrc = $state<string | null>(null);
  const cleanupTimers = new SvelteMap<number, ReturnType<typeof setTimeout>>();

  const durationStyle = $derived(`--crossfade-duration: ${durationMs}ms;`);
  const imageStyleValue = $derived(
    imageStyle ? `${durationStyle} ${imageStyle}` : durationStyle,
  );
  const imageAriaHidden = $derived(
    ariaHidden === true
      ? "true"
      : ariaHidden === false
        ? undefined
        : ariaHidden,
  );
  const dataProps = $derived(
    Object.fromEntries(
      Object.entries(dataAttributes)
        .filter(([, value]) => value !== null && value !== undefined)
        .map(([key, value]) => [`data-${key}`, String(value)]),
    ),
  );

  $effect(() => {
    if (src === lastRequestedSrc) {
      return;
    }

    lastRequestedSrc = src;

    if (!src) {
      fadeOutAllLayers();
      return;
    }

    const existing = layers.find(
      (layer) => layer.src === src && !layer.leaving,
    );
    if (existing) {
      activateLayer(existing.id);
      return;
    }

    const hasVisibleLayer = layers.some(
      (layer) => layer.visible && !layer.leaving,
    );
    const nextLayer: ImageLayer = {
      id: ++layerSequence,
      src,
      visible: !hasVisibleLayer,
      leaving: false,
      pending: hasVisibleLayer,
    };
    layers = [...layers, nextLayer];
  });

  function fadeOutAllLayers() {
    const activeIds = layers
      .filter((layer) => !layer.leaving)
      .map((layer) => layer.id);
    layers = layers.map((layer) => ({
      ...layer,
      visible: false,
      leaving: true,
    }));
    for (const id of activeIds) {
      scheduleRemoval(id);
    }
  }

  function activateLayer(layerId: number) {
    const target = layers.find((layer) => layer.id === layerId);
    if (!target || target.leaving) {
      return;
    }

    const leavingIds = layers
      .filter((layer) => layer.id !== layerId)
      .map((layer) => layer.id);

    layers = layers.map((layer) =>
      layer.id === layerId
        ? { ...layer, visible: true, pending: false, leaving: false }
        : { ...layer, visible: false, pending: false, leaving: true },
    );

    for (const id of leavingIds) {
      scheduleRemoval(id);
    }
  }

  function scheduleRemoval(layerId: number) {
    clearRemoval(layerId);
    const timer = setTimeout(() => {
      cleanupTimers.delete(layerId);
      layers = layers.filter((layer) => layer.id !== layerId);
    }, durationMs);
    cleanupTimers.set(layerId, timer);
  }

  function clearRemoval(layerId: number) {
    const timer = cleanupTimers.get(layerId);
    if (!timer) return;
    clearTimeout(timer);
    cleanupTimers.delete(layerId);
  }

  function handleLoad(layer: ImageLayer, event: Event) {
    onImageLoad?.(event);
    if (layer.src !== lastRequestedSrc || layer.leaving) {
      return;
    }
    activateLayer(layer.id);
  }

  function handleError(layer: ImageLayer, event: Event) {
    onImageError?.(event);
    if (layer.pending) {
      layers = layers.filter((current) => current.id !== layer.id);
    }
  }

  $effect(() => {
    return () => {
      for (const timer of cleanupTimers.values()) {
        clearTimeout(timer);
      }
      cleanupTimers.clear();
    };
  });
</script>

{#each layers as layer (layer.id)}
  <img
    class={`crossfade-image-layer ${imageClass}`}
    class:visible={layer.visible}
    class:leaving={layer.leaving}
    src={layer.src}
    {alt}
    aria-hidden={imageAriaHidden}
    style={imageStyleValue}
    {...dataProps}
    onload={(event) => handleLoad(layer, event)}
    onerror={(event) => handleError(layer, event)}
  />
{/each}

<style>
  .crossfade-image-layer {
    opacity: 0;
    transition: opacity var(--crossfade-duration, 300ms) ease;
  }

  .crossfade-image-layer.visible {
    opacity: 1;
  }

  .crossfade-image-layer.leaving {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .crossfade-image-layer {
      --crossfade-duration: 1ms;
    }
  }
</style>
