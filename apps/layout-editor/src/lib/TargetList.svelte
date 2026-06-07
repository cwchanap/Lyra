<script lang="ts">
  import type { InvestigationSceneJson } from "./layout-types";

  let {
    scene,
    currentSublocationId,
    onSelectSublocation,
  }: {
    scene: InvestigationSceneJson;
    currentSublocationId: string | null;
    onSelectSublocation: (sublocationId: string) => void;
  } = $props();
</script>

<section class="target-list" aria-label="Sublocations">
  <h2>Sublocations</h2>
  <div class="sublocation-buttons">
    {#each scene.sublocations as sublocation (sublocation.id)}
      <button
        type="button"
        class:active={sublocation.id === currentSublocationId}
        onclick={() => onSelectSublocation(sublocation.id)}
      >
        <span>{sublocation.label}</span>
        <small>{sublocation.id}</small>
      </button>
    {/each}
  </div>
</section>

<style>
  .target-list {
    display: grid;
    gap: 10px;
    margin-top: 24px;
    padding-top: 20px;
    border-top: 1px solid #e4ded3;
  }

  h2 {
    margin: 0;
    color: #60706b;
    font-size: 0.78rem;
    letter-spacing: 0;
    text-transform: uppercase;
  }

  .sublocation-buttons {
    display: grid;
    gap: 8px;
  }

  button {
    display: grid;
    gap: 3px;
    width: 100%;
    min-height: 40px;
    padding: 8px 10px;
    border: 1px solid #c9d0ca;
    border-radius: 6px;
    background: #ffffff;
    color: #26302e;
    text-align: left;
    cursor: pointer;
  }

  button:hover,
  button.active {
    border-color: #57776a;
    background: #edf4f0;
  }

  span,
  small {
    min-width: 0;
    overflow-wrap: anywhere;
  }

  span {
    font-weight: 700;
  }

  small {
    color: #60706b;
  }
</style>
