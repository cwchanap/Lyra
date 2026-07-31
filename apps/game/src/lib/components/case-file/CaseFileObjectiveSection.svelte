<script lang="ts">
  import type {
    CaseFileObjectives,
    CaseFileObjectiveItem,
  } from "$lib/case-file/types";

  let {
    objectives,
    selected,
    disabled = false,
  }: {
    objectives: CaseFileObjectives;
    selected: CaseFileObjectiveItem | null;
    disabled?: boolean;
  } = $props();
  let showEarlierCompleted = $state(false);
</script>

<div
  id="case-file-section-objective"
  role="tabpanel"
  aria-labelledby="case-file-tab-objective"
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    目前目標
  </h2>
  {#if selected !== null}
    <p>{selected.objective.summary}</p>
  {:else}
    <p>目前沒有可追蹤的目標。</p>
  {/if}

  {#if objectives.activePrimary !== null}
    <section aria-label="主要目標">
      <h3>主要目標</h3>
      <p>{objectives.activePrimary.label}</p>
    </section>
  {/if}

  {#if objectives.incompleteSecondaries.length > 0}
    <section aria-label="次要目標">
      <h3>次要目標</h3>
      <ul>
        {#each objectives.incompleteSecondaries as objective (objective.id)}
          <li>{objective.label}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if objectives.recentCompleted.length > 0}
    <section aria-label="最近完成">
      <h3>最近完成</h3>
      <ul>
        {#each objectives.recentCompleted as objective (objective.id)}
          <li>{objective.label}</li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if objectives.earlierCompleted.length > 0}
    <button
      type="button"
      {disabled}
      aria-expanded={showEarlierCompleted}
      onclick={() => (showEarlierCompleted = !showEarlierCompleted)}
      >{showEarlierCompleted ? "收起較早完成目標" : "顯示較早完成目標"}</button
    >
    {#if showEarlierCompleted}
      <ul aria-label="較早完成目標">
        {#each objectives.earlierCompleted as objective (objective.id)}
          <li>{objective.label}</li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>
