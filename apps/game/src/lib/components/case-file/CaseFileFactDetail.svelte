<script lang="ts">
  import type {
    CaseFileFactItem,
    CaseFileItem,
    CaseFileKey,
  } from "$lib/case-file/types";

  let {
    item,
    supportingRecords,
    supportingFacts,
    onNavigate,
  }: {
    item: CaseFileFactItem;
    supportingRecords: CaseFileItem[];
    supportingFacts: CaseFileItem[];
    onNavigate: (key: CaseFileKey) => void;
  } = $props();

  const origin = $derived(
    item.fact.originContext.type === "migration"
      ? "已匯入的進度"
      : `${item.fact.originContext.location.chapterTitle}・${item.fact.originContext.location.sceneTitle}`,
  );

  function itemLabel(support: CaseFileItem): string {
    if ("record" in support) {
      return "name" in support.record
        ? support.record.name
        : support.record.speaker;
    }
    if ("fact" in support) return support.fact.label;
    if ("question" in support) return support.question.label;
    if ("objective" in support) return support.objective.label;
    return support.authorization.label;
  }
</script>

<section
  id="case-file-section-facts"
  aria-labelledby="case-file-detail-heading"
>
  <h2 id="case-file-detail-heading" data-case-file-detail-heading tabindex="-1">
    事實：{item.fact.label}
  </h2>
  <p>{item.fact.summary}</p>
  <p>{item.fact.details}</p>
  <p>來源：<span>{origin}</span></p>

  {#if supportingRecords.length > 0}
    <section aria-label="直接支持紀錄">
      <h3>直接支持紀錄</h3>
      <ul>
        {#each supportingRecords as support (support.key)}
          <li>
            <button type="button" onclick={() => onNavigate(support.key)}
              >查看支持記錄：{itemLabel(support)}</button
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
            <button type="button" onclick={() => onNavigate(support.key)}
              >查看支持事實：{itemLabel(support)}</button
            >
          </li>
        {/each}
      </ul>
    </section>
  {/if}
</section>
