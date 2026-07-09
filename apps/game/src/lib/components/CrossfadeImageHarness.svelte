<script lang="ts">
  import CrossfadeImage from "./CrossfadeImage.svelte";

  const dataAttributes = { placement: "left", layer: "behind-dialogue" };
  const onImageLoad = () => {};
  const onImageError = () => {};

  let src = $state("/old.png");

  function swap() {
    src = "/new.png";
  }
</script>

<button type="button" onclick={swap}>swap</button>

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
