<script lang="ts">
  import CrossfadeImage from "$lib/components/CrossfadeImage.svelte";

  const dataAttributes = { placement: "left", layer: "behind-dialogue" };
  const onImageLoad = () => {};
  const onImageError = () => {};

  let src = $state("/old.png");

  function swap() {
    src = "/new.png";
  }

  function rapidSwap() {
    src = "/middle.png";
    queueMicrotask(() => {
      src = "/newest.png";
    });
  }
</script>

<button type="button" data-crossfade-action="swap" onclick={swap}>swap</button>
<button type="button" data-crossfade-action="rapid" onclick={rapidSwap}>
  rapid swap
</button>

<CrossfadeImage
  {src}
  imageClass="portrait left"
  imageStyle="--portrait-height: min(1536px, 80vh);"
  alt=""
  ariaHidden={true}
  durationMs={300}
  {dataAttributes}
  {onImageLoad}
  {onImageError}
/>
