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

<section
  class="target-list mt-6 grid gap-2.5 border-t border-[#e4ded3] pt-5"
  aria-label="Sublocations"
>
  <h2 class="m-0 text-[0.78rem] tracking-normal text-[#60706b] uppercase">
    Sublocations
  </h2>
  <div class="sublocation-buttons grid gap-2">
    {#each scene.sublocations as sublocation (sublocation.id)}
      <button
        type="button"
        class={[
          "grid min-h-10 w-full cursor-pointer gap-[3px] rounded-md border px-2.5 py-2 text-left text-[#26302e]",
          sublocation.id === currentSublocationId
            ? "active border-[#57776a] bg-[#edf4f0]"
            : "border-[#c9d0ca] bg-white hover:border-[#57776a] hover:bg-[#edf4f0]",
        ].join(" ")}
        onclick={() => onSelectSublocation(sublocation.id)}
      >
        <span class="min-w-0 break-words font-bold">{sublocation.label}</span>
        <small class="min-w-0 break-words text-[#60706b]"
          >{sublocation.id}</small
        >
      </button>
    {/each}
  </div>
</section>
