<script lang="ts">
  import { resolveStoryAsset, type ResolvedStoryAsset } from "$lib/assets/story-assets";

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
    resolved = null;
    resolveStoryAsset(backgroundAssetId, "background").then((asset) => {
      if (!cancelled) resolved = asset;
    });
    return () => {
      cancelled = true;
    };
  });
</script>

{#if sceneTag || backgroundAssetId || resolved}
  <div class="backdrop">
    {#if resolved}
      <img class="background-image" src={resolved.url} alt="" aria-hidden="true" />
    {/if}
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

  .background-image {
    position: fixed;
    inset: 0;
    z-index: 0;
    width: 100vw;
    height: 100vh;
    object-fit: cover;
    opacity: 0.52;
    pointer-events: none;
  }

  .stamp {
    position: relative;
    z-index: 1;
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
    align-items: center;
  }

  .label {
    padding: 6px 14px 5px;
    font-family: var(--serif-jp);
    font-weight: 500;
    font-size: 13px;
    color: var(--bone);
    letter-spacing: 0.08em;
    display: inline-flex;
    align-items: center;
  }
</style>
