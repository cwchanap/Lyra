<script lang="ts">
  import { untrack } from "svelte";
  import { SvelteMap } from "svelte/reactivity";

  type ImageDataAttributeValue = string | number | boolean | null | undefined;

  type ImageLayerPresentation = {
    className: string;
    style: string;
    ariaHidden?: "true" | "false";
    dataProps: Record<string, string>;
  };

  type ImageLayer = {
    id: number;
    key: string;
    requestOrder: number;
    src: string;
    visible: boolean;
    leaving: boolean;
    pending: boolean;
    presentation: ImageLayerPresentation;
  };

  let {
    src,
    transitionKey = null,
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
    transitionKey?: string | null;
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
  let requestSequence = 0;
  let currentRequestOrder = $state(0);
  // Intentionally a plain `let`, not `$state`: this tracks the last requested
  // transition key inside untrack() so it must NOT trigger reactivity. Making
  // it reactive would re-run the $effect on every assignment and re-enter the
  // untrack block, causing spurious layer churn.
  let lastRequestedKey: string | null = null;
  // SvelteMap is required by the svelte/prefer-svelte-reactivity lint rule
  // even though these timers are never read in a reactive context.
  const cleanupTimers = new SvelteMap<number, ReturnType<typeof setTimeout>>();

  $effect(() => {
    const desiredSrc = src;
    const desiredKey = desiredSrc ? (transitionKey ?? desiredSrc) : null;
    const presentation = snapshotPresentation();

    untrack(() => {
      if (desiredKey === lastRequestedKey) {
        if (!desiredKey) {
          return;
        }

        const existingIndex = layers.findIndex(
          (layer) => layer.key === desiredKey && !layer.leaving,
        );
        if (existingIndex === -1) {
          return;
        }

        const existing = layers[existingIndex];
        if (hasSamePresentation(existing.presentation, presentation)) {
          return;
        }

        layers = layers.map((layer, index) =>
          index === existingIndex ? { ...layer, presentation } : layer,
        );
        return;
      }

      lastRequestedKey = desiredKey;
      currentRequestOrder = ++requestSequence;

      if (!desiredSrc || !desiredKey) {
        fadeOutAllLayers();
        return;
      }

      const existing = layers.find(
        (layer) => layer.key === desiredKey && !layer.leaving,
      );
      if (existing) {
        if (existing.pending) {
          const leavingIds = layers
            .filter((layer) => layer.id !== existing.id)
            .map((layer) => layer.id);
          layers = layers.map((layer) =>
            layer.id === existing.id
              ? { ...layer, requestOrder: currentRequestOrder }
              : { ...layer, visible: false, pending: false, leaving: true },
          );
          for (const id of leavingIds) {
            scheduleRemoval(id);
          }
          return;
        }
        activateLayer(existing.id, currentRequestOrder);
        return;
      }

      const hasVisibleLayer = layers.some(
        (layer) => layer.visible && !layer.leaving,
      );
      const retainedLayers = hasVisibleLayer
        ? layers.filter(
            (layer) => !layer.pending || layer.visible || layer.leaving,
          )
        : layers;
      const nextLayer: ImageLayer = {
        id: ++layerSequence,
        key: desiredKey,
        requestOrder: currentRequestOrder,
        src: desiredSrc,
        visible: !hasVisibleLayer,
        leaving: false,
        pending: true,
        presentation,
      };
      layers = [...retainedLayers, nextLayer];
    });
  });

  function snapshotPresentation(): ImageLayerPresentation {
    const style = imageStyle
      ? `--crossfade-duration: ${durationMs}ms; ${imageStyle}`
      : `--crossfade-duration: ${durationMs}ms;`;

    return {
      className: imageClass,
      style,
      ariaHidden:
        ariaHidden === true
          ? "true"
          : ariaHidden === false
            ? undefined
            : ariaHidden,
      dataProps: Object.fromEntries(
        Object.entries(dataAttributes)
          .filter(([, value]) => value !== null && value !== undefined)
          .map(([key, value]) => [`data-${key}`, String(value)]),
      ),
    };
  }

  function hasSamePresentation(
    left: ImageLayerPresentation,
    right: ImageLayerPresentation,
  ) {
    if (
      left.className !== right.className ||
      left.style !== right.style ||
      left.ariaHidden !== right.ariaHidden
    ) {
      return false;
    }

    const leftKeys = Object.keys(left.dataProps);
    const rightKeys = Object.keys(right.dataProps);
    if (leftKeys.length !== rightKeys.length) {
      return false;
    }

    return leftKeys.every(
      (key) => left.dataProps[key] === right.dataProps[key],
    );
  }

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

  function activateLayer(layerId: number, requestOrder?: number) {
    const target = layers.find((layer) => layer.id === layerId);
    if (!target || target.leaving) {
      return;
    }

    const leavingIds = layers
      .filter((layer) => layer.id !== layerId)
      .map((layer) => layer.id);

    layers = layers.map((layer) =>
      layer.id === layerId
        ? {
            ...layer,
            requestOrder: requestOrder ?? layer.requestOrder,
            visible: true,
            pending: false,
            leaving: false,
          }
        : { ...layer, visible: false, pending: false, leaving: true },
    );

    for (const id of leavingIds) {
      scheduleRemoval(id);
    }
  }

  // Under prefers-reduced-motion the CSS transition collapses to 1ms (see the
  // reduced-motion media query in the style block below), so waiting the full
  // durationMs would leave invisible `leaving` layers in the DOM for up to 1.5s
  // during rapid advances. Match the removal delay to the effective CSS
  // duration: a small grace period lets the browser paint the 1ms transition
  // before the node is detached.
  const REDUCED_MOTION_REMOVAL_GRACE_MS = 50;
  // For the normal path the CSS transition duration equals durationMs, so a
  // timer set to exactly durationMs can fire just before the browser paints
  // the transition's final frame and yank the node mid-fade. A small grace
  // ensures the fade completes before the layer is detached.
  const REMOVAL_GRACE_MS = 50;

  function removalDelayMs() {
    if (
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return REDUCED_MOTION_REMOVAL_GRACE_MS;
    }
    return durationMs + REMOVAL_GRACE_MS;
  }

  function scheduleRemoval(layerId: number) {
    clearRemoval(layerId);
    const timer = setTimeout(() => {
      cleanupTimers.delete(layerId);
      layers = layers.filter((layer) => layer.id !== layerId);
    }, removalDelayMs());
    cleanupTimers.set(layerId, timer);
  }

  function clearRemoval(layerId: number) {
    const timer = cleanupTimers.get(layerId);
    if (!timer) return;
    clearTimeout(timer);
    cleanupTimers.delete(layerId);
  }

  function removeLayer(layerId: number) {
    clearRemoval(layerId);
    layers = layers.filter((layer) => layer.id !== layerId);
  }

  function handleLoad(layerId: number, event: Event) {
    const layer = layers.find((current) => current.id === layerId);
    if (!layer) {
      return;
    }
    if (layer.key !== lastRequestedKey || layer.leaving) {
      if (layer.pending) {
        removeLayer(layer.id);
      }
      return;
    }
    if (!layer.pending) {
      return;
    }
    onImageLoad?.(event);
    activateLayer(layer.id);
  }

  function handleError(layerId: number, event: Event) {
    const layer = layers.find((current) => current.id === layerId);
    if (!layer) {
      return;
    }
    if (layer.key !== lastRequestedKey || layer.leaving) {
      if (layer.pending) {
        removeLayer(layer.id);
      }
      return;
    }
    if (!layer.pending) {
      return;
    }
    onImageError?.(event);
    removeLayer(layer.id);
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
    class={`crossfade-image-layer ${layer.presentation.className}`}
    class:visible={layer.visible}
    class:leaving={layer.leaving}
    src={layer.src}
    {alt}
    aria-hidden={layer.leaving ? "true" : layer.presentation.ariaHidden}
    style={layer.presentation.style}
    data-save-crossfade-layer=""
    data-save-crossfade-request={currentRequestOrder}
    data-save-crossfade-order={layer.requestOrder}
    data-save-crossfade-state={layer.leaving
      ? "leaving"
      : layer.pending
        ? "pending"
        : "visible"}
    {...layer.presentation.dataProps}
    onload={(event) => handleLoad(layer.id, event)}
    onerror={(event) => handleError(layer.id, event)}
  />
{/each}

<style>
  .crossfade-image-layer {
    opacity: 0;
    transition: var(
      --save-crossfade-transition,
      opacity var(--crossfade-duration, 300ms) ease
    );
  }

  .crossfade-image-layer.visible {
    opacity: var(--save-crossfade-opacity, var(--crossfade-visible-opacity, 1));
  }

  .crossfade-image-layer.leaving {
    opacity: 0;
  }

  @media (prefers-reduced-motion: reduce) {
    .crossfade-image-layer {
      transition-duration: 1ms;
    }
  }
</style>
