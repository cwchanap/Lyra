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
    `${item.fact.originContext.location.chapterTitle}・${item.fact.originContext.location.sceneTitle}`,
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

  <section aria-label="直接支持紀錄">
    <h3>直接支持紀錄</h3>
    {#if supportingRecords.length > 0}
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
    {:else}
      <p class="support-empty">沒有可顯示的已取得直接支持紀錄。</p>
    {/if}
  </section>

  <section aria-label="直接支持事實">
    <h3>直接支持事實</h3>
    {#if supportingFacts.length > 0}
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
    {:else}
      <p class="support-empty">沒有可顯示的已確認直接支持事實。</p>
    {/if}
  </section>
</div>

<style>
  .support-empty {
    margin: 0;
    color: var(--bone-faint);
    font-family: var(--serif-jp);
    font-size: 13px;
    font-style: italic;
  }
</style>
