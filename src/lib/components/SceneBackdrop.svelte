<script lang="ts">
  let { sceneTag }: { sceneTag: string | null } = $props();
</script>

{#if sceneTag}
  <div class="backdrop">
    <span class="stamp">
      <span class="kana">場 / SCENE</span>
      <span class="label">{sceneTag}</span>
    </span>
  </div>
{/if}

<style>
  .backdrop {
    position: relative;
    padding: 18px clamp(20px, 3vw, 40px);
  }

  .stamp {
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
