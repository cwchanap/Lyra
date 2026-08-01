<script lang="ts">
  import type {
    CaseFileFactItem,
    CaseFileItem,
    CaseFileKey,
  } from "$lib/case-file/types";
  import { caseFileItemLabel } from "$lib/case-file/labels";

  let {
    item,
    supportingRecords,
    supportingFacts,
    onNavigate,
    disabled = false,
  }: {
    item: CaseFileFactItem;
    supportingRecords: CaseFileItem[];
    supportingFacts: CaseFileItem[];
    onNavigate: (key: CaseFileKey) => void;
    disabled?: boolean;
  } = $props();

  const origin = $derived(
    item.fact.originContext.type === "migration"
      ? "已匯入的進度"
      : `${item.fact.originContext.location.chapterTitle}・${item.fact.originContext.location.sceneTitle}`,
  );
</script>

<div
  id="case-file-section-facts"
  role="tabpanel"
  aria-labelledby="case-file-tab-facts"
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    事實：{item.fact.label}
  </h2>
  <p>{item.fact.summary}</p>
  <p>{item.fact.details}</p>
  <p>類別：{item.fact.category}</p>
  <p>來源：<span>{origin}</span></p>

  {#if supportingRecords.length > 0}
    <section aria-label="直接支持紀錄">
      <h3>直接支持紀錄</h3>
      <ul>
        {#each supportingRecords as support (support.key)}
          <li>
            <button
              type="button"
              {disabled}
              onclick={() => onNavigate(support.key)}
              >查看支持記錄：{caseFileItemLabel(support)}</button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if supportingFacts.length > 0}
    <section aria-label="直接支持事實">
      <h3>直接支持事實</h3>
      <ul>
        {#each supportingFacts as support (support.key)}
          <li>
            <button
              type="button"
              {disabled}
              onclick={() => onNavigate(support.key)}
              >查看支持事實：{caseFileItemLabel(support)}</button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</div>
